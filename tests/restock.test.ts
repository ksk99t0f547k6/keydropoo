import {it,expect} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus,exportCodes,archiveProduct} from "../src/lib/server/inventory";
import {restockBatch} from "../src/lib/server/restock";
import {getOrder,reserveOrder,attachCheckout,settleOrder,fulfillWaitingOrder,deliverOrder} from "../src/lib/server/orders";
const secret="ab".repeat(32);
async function setup(){
 const database=testDatabase();const product=await createProduct(database.db,{name:"App",slug:"app",priceMinor:500,shortagePolicy:"backorder"});
 const batch=await createBatch(database.db,secret,{productId:product.id,name:"Sales",kind:"external",source:"import",codes:["original"]});
 return {...database,product,batch,input:{productId:product.id,batchId:batch.id,idempotencyKey:crypto.randomUUID(),codes:["000-new"]}};
}
it("補貨沿用批次，加密保留前導零；重試不增加庫存，變更內容拒絕",async()=>{
 const {db,sqlite,input}=await setup();try{
  const receipt=await restockBatch(db,secret,input);
  expect(await restockBatch(db,secret,input)).toEqual(receipt);
  expect(sqlite.prepare("SELECT count(*) n FROM codes").get()?.n).toBe(2);
  await expect(restockBatch(db,secret,{...input,codes:["changed"]})).rejects.toThrow("STOCK_IDEMPOTENCY_CONFLICT");
  expect((await exportCodes(db,secret,input)).map(c=>c.code)).toContain("000-new");
 }finally{sqlite.close();}
});
it("重複碼使收據和整批回滾，修正後同鍵可以重試",async()=>{
 const {db,sqlite,input}=await setup();try{
  await expect(restockBatch(db,secret,{...input,codes:["new","original"]})).rejects.toThrow();
  expect(sqlite.prepare("SELECT count(*) n FROM stock_additions").get()?.n).toBe(0);
  expect(sqlite.prepare("SELECT count(*) n FROM codes").get()?.n).toBe(1);
  expect((await restockBatch(db,secret,input)).count).toBe(1);
 }finally{sqlite.close();}
});
it("不同商品及封存商品無法補貨",async()=>{
 const {db,sqlite,input,product}=await setup();try{
  const other=await createProduct(db,{name:"Other",slug:"other"});
  await expect(restockBatch(db,secret,{...input,productId:other.id})).rejects.toThrow("STOCK_SOURCE_UNAVAILABLE");
  await archiveProduct(db,product.id,true);
  await expect(restockBatch(db,secret,input)).rejects.toThrow("STOCK_SOURCE_UNAVAILABLE");
  expect(sqlite.prepare("SELECT count(*) n FROM stock_additions").get()?.n).toBe(0);
 }finally{sqlite.close();}
});
it("已付款缺貨訂單使用原批次新庫存交付，重試不再次分配",async()=>{
 const {db,sqlite,input}=await setup();try{
  const order=await reserveOrder(db,{productId:input.productId,batchId:input.batchId,buyerKey:"buyer",idempotencyKey:crypto.randomUUID()});
  await attachCheckout(db,order.id,"cs_test");
  await changeCodeStatus(db,{productId:input.productId,ids:[order.reserved_code_id],action:"revoke"});
  expect((await settleOrder(db,{orderId:order.id,sessionId:"cs_test",paymentIntentId:"pi_test",amountMinor:500,currency:"USD"})).status).toBe("backorder");
  await restockBatch(db,secret,input);
  const fulfilled=await fulfillWaitingOrder(db,order.id);
  expect(fulfilled?.status).toBe("fulfilled");
  expect((await deliverOrder(db,secret,order.id,"buyer")).code).toBe("000-new");
  expect((await fulfillWaitingOrder(db,order.id))?.code_id).toBe(fulfilled?.code_id);
 }finally{sqlite.close();}
});

it("維護排程釋放逾時預留並補發已付款缺貨單，重跑不重發",async()=>{
 const {maintainOrders}=await import("../src/lib/server/order-maintenance");
 const {db,sqlite,input}=await setup();try{
  const first=await reserveOrder(db,{productId:input.productId,batchId:input.batchId,buyerKey:"buyer1",idempotencyKey:crypto.randomUUID()},1000);
  await attachCheckout(db,first.id,"cs_test");
  const now=(await getOrder(db,first.id))!.reserved_until+1;
  await maintainOrders(db,now);
  const pending=await reserveOrder(db,{productId:input.productId,batchId:input.batchId,buyerKey:"buyer2",idempotencyKey:crypto.randomUUID()},now);
  expect((await settleOrder(db,{orderId:first.id,sessionId:"cs_test",paymentIntentId:"pi_test",amountMinor:500,currency:"USD"},now)).status).toBe("backorder");
  expect(await maintainOrders(db,now)).toEqual({expired:0,checked:0,fulfilled:0});
  expect(await maintainOrders(db,pending.reserved_until)).toEqual({expired:1,checked:1,fulfilled:1});
  expect(await maintainOrders(db,pending.reserved_until+1)).toEqual({expired:0,checked:0,fulfilled:0});
  expect((await deliverOrder(db,secret,first.id,"buyer1")).code).toBe("original");
 }finally{sqlite.close();}
});
it.each(["manual","refunded","archived"])("維護排程不交付 %s 訂單",async mode=>{
 const {maintainOrders}=await import("../src/lib/server/order-maintenance");
 const {refundOrder}=await import("../src/lib/server/orders");
 const {db,sqlite,input,product}=await setup();try{
  if(mode==='manual')sqlite.prepare("UPDATE products SET shortage_policy='manual'").run();
  const order=await reserveOrder(db,{productId:input.productId,batchId:input.batchId,buyerKey:"buyer",idempotencyKey:crypto.randomUUID()});
  await attachCheckout(db,order.id,"cs_test");
  await changeCodeStatus(db,{productId:input.productId,ids:[order.reserved_code_id],action:"revoke"});
  await settleOrder(db,{orderId:order.id,sessionId:"cs_test",paymentIntentId:"pi_test",amountMinor:500,currency:"USD"});
  await restockBatch(db,secret,input);
  if(mode==='refunded')await refundOrder(db,"pi_test",500);
  if(mode==='archived')await archiveProduct(db,product.id,true);
  expect((await maintainOrders(db)).checked).toBe(0);
  expect(sqlite.prepare("SELECT code_id FROM orders WHERE id=?").get(order.id)?.code_id).toBeNull();
 }finally{sqlite.close();}
});
