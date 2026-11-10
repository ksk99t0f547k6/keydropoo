import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {reserveOrder,attachCheckout,settleOrder,expireReservations,refundOrder,fulfillWaitingOrder,purchasedOrderCount,deliverOrder,getOrder} from "../src/lib/server/orders";
const secret="ab".repeat(32);
async function setup(options:{policy?:"refund"|"manual"|"backorder";kind?:"external"|"redemption";revoke?:boolean}={}){
 const database=testDatabase();const {db}=database;
 const product=await createProduct(db,{name:"App",slug:"app",priceMinor:500,currency:"USD",shortagePolicy:options.policy??"refund",revokeOnRefund:options.revoke??true});
 const batch=await createBatch(db,secret,{productId:product.id,name:"Sales",kind:options.kind??"redemption",source:"manual",codes:["SALE-ONE"]});
 const input={productId:product.id,batchId:batch.id,buyerKey:"buyer-1",userId:"user-1",idempotencyKey:crypto.randomUUID()};
 const payment=(orderId:string)=>({orderId,sessionId:"cs_test_session",paymentIntentId:"pi_test_payment",amountMinor:500,currency:"USD"});
 return {...database,product,batch,input,payment};
}
it("預留最後一碼競爭不超賣，相同冪等鍵不重複建立訂單",async()=>{
 const {db,sqlite,input}=await setup();try{
  const results=await Promise.allSettled([reserveOrder(db,input,1000),reserveOrder(db,{...input,buyerKey:"buyer-2",idempotencyKey:crypto.randomUUID()},1000)]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  const order=await reserveOrder(db,input,1000);expect(await reserveOrder(db,input,2000)).toEqual(order);
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("reserved");
  await expect(reserveOrder(db,{...input,userId:"different"})).rejects.toThrow("ORDER_IDEMPOTENCY_CONFLICT");
 }finally{sqlite.close();}
});
it("付款金額／貨幣／session 核對，重試不重發；持有人才能讀取碼",async()=>{
 const {db,sqlite,input,payment}=await setup();try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");
  await expect(settleOrder(db,{...payment(order.id),amountMinor:1},2000)).rejects.toThrow("ORDER_PAYMENT_MISMATCH");
  await expect(settleOrder(db,{...payment(order.id),currency:"EUR"},2000)).rejects.toThrow("ORDER_PAYMENT_MISMATCH");
  await expect(settleOrder(db,{...payment(order.id),sessionId:"other"},2000)).rejects.toThrow("ORDER_PAYMENT_MISMATCH");
  const settled=await settleOrder(db,payment(order.id),2000);expect(settled.status).toBe("fulfilled");
  expect((await settleOrder(db,payment(order.id),3000)).code_id).toBe(settled.code_id);
  await expect(deliverOrder(db,secret,order.id,"buyer-2")).rejects.toThrow("ORDER_NOT_FOUND");
  expect(await deliverOrder(db,secret,order.id,input.buyerKey)).toMatchObject({code:"SALE-ONE"});
  expect(await purchasedOrderCount(db,"user-1",input.productId)).toBe(1);
 }finally{sqlite.close();}
});
it.each(["refund","manual","backorder"] as const)("延遲付款不能奪走其他訂單預留，依 %s 兜底",async policy=>{
 const {db,sqlite,input,payment}=await setup({policy});try{
  const reserved=await reserveOrder(db,input,1000);await attachCheckout(db,reserved.id,"cs_test_session");
  // Session 建立後預留延長到 Session 到期＋Webhook 寬限；寬限結束才由排程釋放。
  const order=(await getOrder(db,reserved.id))!;
  expect((await expireReservations(db,order.reserved_until)).expired).toBe(1);
  const other=await reserveOrder(db,{...input,buyerKey:"buyer-2",idempotencyKey:crypto.randomUUID()},order.reserved_until+1);
  const late=await settleOrder(db,payment(order.id),order.reserved_until+2);
  expect(late.status).toBe(policy==="refund"?"refund_pending":policy);expect(late.code_id).toBeNull();
  expect(sqlite.prepare("SELECT status FROM codes WHERE id=?").get(other.reserved_code_id)?.status).toBe("reserved");
 }finally{sqlite.close();}
});
it("補貨發碼只處理已付款等待單，人工模式需明確啟用",async()=>{
 const {db,sqlite,input,payment}=await setup({policy:"manual"});try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");
  await changeCodeStatus(db,{productId:input.productId,ids:[order.reserved_code_id],action:"revoke"});
  expect((await settleOrder(db,payment(order.id),2000)).status).toBe("manual");
  await changeCodeStatus(db,{productId:input.productId,ids:[order.reserved_code_id],action:"restore"});
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("available");
  expect((await fulfillWaitingOrder(db,order.id,false,3000))?.status).toBe("manual");
  expect((await fulfillWaitingOrder(db,order.id,true,3000))?.status).toBe("fulfilled");
  expect((await fulfillWaitingOrder(db,order.id,true,4000))?.code_id).toBe(order.reserved_code_id);
 }finally{sqlite.close();}
});
it.each([{kind:"redemption" as const,revoke:true,expected:"revoked"},{kind:"redemption" as const,revoke:false,expected:"assigned"},{kind:"external" as const,revoke:true,expected:"assigned"}])("退款只自動撤銷可控且啟用撤銷的碼：%j",async options=>{
 const {db,sqlite,input,payment}=await setup(options);try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");await settleOrder(db,payment(order.id),2000);
  expect((await refundOrder(db,"pi_test_payment",100,3000)).status).toBe("fulfilled");
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("assigned");
  const full=await refundOrder(db,"pi_test_payment",500,4000);expect(full.status).toBe("refunded");
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe(options.expected);
  expect((await refundOrder(db,"pi_test_payment",100,5000)).refunded_minor).toBe(500);
  expect((await settleOrder(db,payment(order.id),6000)).status).toBe("refunded");
  expect(await purchasedOrderCount(db,"user-1",input.productId)).toBe(0);
 }finally{sqlite.close();}
});
it("先確認全額退款的付款不發碼並釋放預留",async()=>{
 const {db,sqlite,input,payment}=await setup();try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");
  const result=await settleOrder(db,{...payment(order.id),refundedMinor:500},2000);
  expect(result.status).toBe("refunded");expect(result.code_id).toBeNull();
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("available");
 }finally{sqlite.close();}
});
it("已售兌換碼只能由買家兌換，全額退款回收可追溯的剩餘額度",async()=>{
 const {saveRewardRule,redeemCode}=await import("../src/lib/server/redemptions");
 const {applyCreditOperation}=await import("../src/lib/server/credits");
 const {db,sqlite,input,payment,batch}=await setup();try{
  await saveRewardRule(db,{productId:input.productId,batchId:batch.id,expectedVersion:0,reward:{kind:"credits",bucket:"requests",amount:100}});
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");await settleOrder(db,payment(order.id),2000);
  await expect(redeemCode(db,"stranger",{productId:input.productId,code:"SALE-ONE",idempotencyKey:crypto.randomUUID()})).rejects.toThrow("REDEMPTION_UNAVAILABLE");
  await redeemCode(db,"user-1",{productId:input.productId,code:"SALE-ONE",idempotencyKey:crypto.randomUUID()});
  const wallet=sqlite.prepare("SELECT id FROM credit_wallets").get()!.id;
  await applyCreditOperation(db,{walletId:wallet,kind:"spend",amount:30,idempotencyKey:"spend-1"});
  await refundOrder(db,"pi_test_payment",500);
  expect(sqlite.prepare("SELECT balance FROM credit_wallets").get()?.balance).toBe(0);
  expect(sqlite.prepare("SELECT balance_delta FROM credit_operations WHERE kind='revoke'").get()?.balance_delta).toBe(-70);
  expect(await deliverOrder(db,secret,order.id,input.buyerKey)).toMatchObject({status:"refunded",code:null});
 }finally{sqlite.close();}
});
it("關閉退款撤銷時，買家仍能查看原碼",async()=>{
 const {db,sqlite,input,payment}=await setup({revoke:false});try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");await settleOrder(db,payment(order.id),2000);await refundOrder(db,"pi_test_payment",500,3000);
  expect(await deliverOrder(db,secret,order.id,input.buyerKey)).toMatchObject({status:"refunded",code:"SALE-ONE"});
 }finally{sqlite.close();}
});
it("付款與預留逾時交錯仍僅有一個持有人",async()=>{
 const {db,sqlite,input,payment}=await setup();try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");
  const results=await Promise.all([settleOrder(db,payment(order.id),order.reserved_until),expireReservations(db,order.reserved_until)]);
  expect(results[0].status).toBe("fulfilled");
  expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("assigned");
  await expect(reserveOrder(db,{...input,buyerKey:"other",idempotencyKey:crypto.randomUUID()},order.reserved_until+1)).rejects.toThrow("ORDER_STOCK_UNAVAILABLE");
 }finally{sqlite.close();}
});
it("已購碼出現在買家我的碼且不洩漏給其他帳號",async()=>{
 const {listMyCodes}=await import("../src/lib/server/my-codes");
 const {db,sqlite,input,payment}=await setup();try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");await settleOrder(db,payment(order.id),2000);
  expect(await listMyCodes(db,secret,"user-1")).toMatchObject({total:1,items:[{id:order.id,source:"purchase",code:"SALE-ONE"}]});
  expect(await listMyCodes(db,secret,"other")).toMatchObject({total:0,items:[]});
 }finally{sqlite.close();}
});
it("購買授權碼的持有人可管理自己的裝置",async()=>{
 const {activateLicense,listOwnedDevices,releaseOwnedDevice}=await import("../src/lib/server/licenses");
 const {db,sqlite,input,payment}=await setup();try{
  sqlite.prepare("UPDATE code_batches SET kind='license'").run();
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,"cs_test_session");await settleOrder(db,payment(order.id),2000);
  const device=await activateLicense(db,secret,"test-identity-secret-at-least-32-characters",{productId:input.productId,code:"SALE-ONE",deviceId:"laptop"});
  expect(await listOwnedDevices(db,'user-1')).toHaveLength(1);expect(await listOwnedDevices(db,'other')).toHaveLength(0);
  await expect(releaseOwnedDevice(db,device.activationId,'other')).rejects.toThrow("LICENSE_DEVICE_NOT_FOUND");
  await releaseOwnedDevice(db,device.activationId,'user-1');
 }finally{sqlite.close();}
});
it("匿名訂單需原瀏覽器證明才可綁定，綁定後只能以目標帳號查看與兌換",async()=>{
 const {linkGuestOrder,listOrders}=await import("../src/lib/server/orders");const {saveRewardRule,redeemCode}=await import("../src/lib/server/redemptions");
 const {db,sqlite,input,payment,batch}=await setup();try{
  sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run('new-owner','Owner','owner@example.test',0);
  const guest=await reserveOrder(db,{...input,userId:null},1000);await attachCheckout(db,guest.id,'cs_test_session');
  await expect(linkGuestOrder(db,guest.id,input.buyerKey,'new-owner','account-key')).rejects.toThrow('ORDER_LINK_UNAVAILABLE');
  await settleOrder(db,payment(guest.id),2000);
  await expect(linkGuestOrder(db,guest.id,'wrong-browser','new-owner','account-key')).rejects.toThrow('ORDER_LINK_UNAVAILABLE');
  await expect(linkGuestOrder(db,guest.id,input.buyerKey,'missing-user','account-key')).rejects.toThrow('ORDER_LINK_UNAVAILABLE');
  await linkGuestOrder(db,guest.id,input.buyerKey,'new-owner','account-key');
  expect(await linkGuestOrder(db,guest.id,input.buyerKey,'new-owner','account-key')).toEqual({linked:true});
  await expect(deliverOrder(db,secret,guest.id,input.buyerKey)).rejects.toThrow('ORDER_NOT_FOUND');
  expect(await deliverOrder(db,secret,guest.id,'account-key')).toMatchObject({linked:true,canLink:false,code:'SALE-ONE'});
  await saveRewardRule(db,{productId:input.productId,batchId:batch.id,expectedVersion:0,reward:{kind:'permanent',plan:'pro'}});
  await redeemCode(db,'new-owner',{productId:input.productId,code:'SALE-ONE',idempotencyKey:crypto.randomUUID()});
  const list=await listOrders(db,{status:'fulfilled',productId:input.productId});expect(list.total).toBe(1);expect(list.orders[0]).not.toHaveProperty('buyer_key');expect(list.orders[0]).not.toHaveProperty('checkout_payload_json');
  expect((await listOrders(db,{status:'pending'})).total).toBe(0);
 }finally{sqlite.close();}
});
it("兩個帳號競爭認領同一匿名訂單只會有一個持有人",async()=>{
 const {linkGuestOrder,getOrder}=await import("../src/lib/server/orders");
 const {db,sqlite,input,payment}=await setup();try{
  for(const id of ['owner-a','owner-b'])sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run(id,id,`${id}@example.test`,0);
  const guest=await reserveOrder(db,{...input,userId:null},1000);await attachCheckout(db,guest.id,'cs_test_session');await settleOrder(db,payment(guest.id),2000);
  const results=await Promise.allSettled(['owner-a','owner-b'].map(id=>linkGuestOrder(db,guest.id,input.buyerKey,id,`key-${id}`)));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const owner=(await getOrder(db,guest.id))!.user_id!;
  expect(await linkGuestOrder(db,guest.id,input.buyerKey,owner,`key-${owner}`)).toEqual({linked:true});
 }finally{sqlite.close();}
});
it('折扣後退款依實付金額判定，保留原價且結算後不可換金額',async()=>{
 const {db,sqlite,input,payment}=await setup();try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,'cs_test_session');
  const charge={...payment(order.id),chargedMinor:300};
  const settled=await settleOrder(db,charge,2000);
  expect(settled).toMatchObject({amount_minor:500,charged_minor:300,status:'fulfilled'});
  expect(await deliverOrder(db,secret,order.id,input.buyerKey)).toMatchObject({amountMinor:300,listAmountMinor:500,code:'SALE-ONE'});
  await expect(settleOrder(db,{...charge,chargedMinor:250},2100)).rejects.toThrow('ORDER_PAYMENT_MISMATCH');
  expect(()=>sqlite.prepare('UPDATE orders SET charged_minor=250 WHERE id=?').run(order.id)).toThrow('ORDER_PAYMENT_MISMATCH');
  await expect(refundOrder(db,'pi_test_payment',301)).rejects.toThrow('ORDER_REFUND_UNMATCHED');
  expect((await refundOrder(db,'pi_test_payment',100,2200)).status).toBe('fulfilled');
  expect((await refundOrder(db,'pi_test_payment',300,2300)).status).toBe('refunded');
  expect(await purchasedOrderCount(db,'user-1',input.productId)).toBe(0);
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('revoked');
 }finally{sqlite.close();}
});
it('零元結算沒有 PaymentIntent，仍交付且重播不重發，也不當作全額退款',async()=>{
 const {db,sqlite,input,payment}=await setup();try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,'cs_test_session');
  const charge={...payment(order.id),chargedMinor:0,paymentIntentId:null};
  const settled=await settleOrder(db,charge,2000);
  expect(settled).toMatchObject({status:'fulfilled',charged_minor:0,payment_intent_id:null,refunded_minor:0});
  expect((await settleOrder(db,charge,3000)).code_id).toBe(settled.code_id);
  expect(await purchasedOrderCount(db,'user-1',input.productId)).toBe(1);
  expect(await deliverOrder(db,secret,order.id,input.buyerKey)).toMatchObject({amountMinor:0,listAmountMinor:500,code:'SALE-ONE'});
  await expect(settleOrder(db,{...charge,refundedMinor:1})).rejects.toThrow();
  await expect(settleOrder(db,{...charge,paymentIntentId:'pi_invalid'})).rejects.toThrow();
 }finally{sqlite.close();}
});
it.each(['refund','manual','backorder'] as const)('零元訂單缺貨策略 %s 可補發，不發起不存在的付款退款',async policy=>{
 const {db,sqlite,input,payment}=await setup({policy});try{
  const order=await reserveOrder(db,input,1000);await attachCheckout(db,order.id,'cs_test_session');
  await changeCodeStatus(db,{productId:input.productId,ids:[order.reserved_code_id],action:'revoke'});
  const settled=await settleOrder(db,{...payment(order.id),chargedMinor:0,paymentIntentId:null},2000);
  expect(settled.status).toBe(policy==='backorder'?'backorder':'manual');
  await changeCodeStatus(db,{productId:input.productId,ids:[order.reserved_code_id],action:'restore'});
  expect((await fulfillWaitingOrder(db,order.id,true,3000))?.status).toBe('fulfilled');
 }finally{sqlite.close();}
});
