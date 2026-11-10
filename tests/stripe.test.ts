import {expect,it,vi} from "vitest";
import type Stripe from "stripe";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {reserveOrder,getOrder} from "../src/lib/server/orders";
import {stripeClient,createOrderCheckout,reconcileCheckout,processStripeEvent,verifyStripeEvent,toStripeAmount,fromStripeAmount,type StripeGateway} from "../src/lib/server/stripe";
import {stripeWebhook} from "../src/lib/server/stripe-http";
async function setup(){
 const database=testDatabase(),{db}=database;
 const product=await createProduct(db,{name:"App",slug:"app",priceMinor:500});
 const batch=await createBatch(db,"ab".repeat(32),{productId:product.id,name:"Sales",kind:"redemption",source:"manual",codes:["PAY-ONE"]});
 const order=await reserveOrder(db,{productId:product.id,batchId:batch.id,buyerKey:"buyer",userId:"user",idempotencyKey:crypto.randomUUID()});
 const state={session:{id:"cs_test_checkout",metadata:{keydrop_order_id:order.id},client_reference_id:order.id,status:"open",payment_status:"unpaid",payment_intent:"pi_payment",amount_total:500,currency:"usd",url:"https://checkout.stripe.com/test"},intent:{id:"pi_payment",metadata:{keydrop_order_id:order.id},status:"succeeded",amount_received:500,currency:"usd"},refunded:0,refundPending:false};
 const gateway:StripeGateway={createCheckout:vi.fn(async()=>state.session),retrieveCheckout:vi.fn(async()=>state.session),retrievePaymentIntent:vi.fn(async()=>state.intent),succeededRefundAmount:vi.fn(async()=>state.refunded),createRefund:vi.fn(async()=>{if(!state.refundPending)state.refunded=500;return {id:"re_refund",status:state.refundPending?"pending":"succeeded"};}),retrieveCharge:vi.fn(async()=>({payment_intent:"pi_payment"})),retrieveRefund:vi.fn(async()=>({payment_intent:"pi_payment"}))};
 const paid=()=>{state.session.status="complete";state.session.payment_status="paid";};
 return {...database,order,state,gateway,paid};
}
function event(id:string,type:string,objectId:string){return {id,type,livemode:false,data:{object:{id:objectId}}} as unknown as Stripe.Event;}
it("建立 Checkout 使用固定價格快照、數量一與穩定冪等參數",async()=>{
 const {db,sqlite,order,gateway}=await setup();try{
  await createOrderCheckout(db,gateway,order,"https://example.test");
  const original=vi.mocked(gateway.createCheckout).mock.calls[0];
  expect(original[0]).toMatchObject({mode:"payment",managed_payments:{enabled:false},automatic_tax:{enabled:false},adaptive_pricing:{enabled:false},line_items:[{quantity:1,price_data:{unit_amount:500,currency:"usd"}}]});
  expect(original[1]).toBe(`keydrop-checkout-${order.id}`);
  sqlite.prepare("UPDATE orders SET checkout_session_id=NULL").run();sqlite.prepare("UPDATE products SET name='Changed',price_minor=900").run();
  await createOrderCheckout(db,gateway,order,"https://example.test");
  expect(vi.mocked(gateway.createCheckout).mock.calls[1]).toEqual(original);
 }finally{sqlite.close();}
});
it("未付款 completed 不發碼；成功後事件重試不重發且已處理事件不再呼叫 Stripe",async()=>{
 const {db,sqlite,order,gateway,paid}=await setup();try{
  await createOrderCheckout(db,gateway,order,"https://example.test");
  const completed=event("evt_completed","checkout.session.completed","cs_test_checkout");
  await processStripeEvent(db,gateway,completed);expect((await getOrder(db,order.id))?.code_id).toBeNull();
  paid();const success=event("evt_success","checkout.session.async_payment_succeeded","cs_test_checkout");
  await processStripeEvent(db,gateway,success);expect((await getOrder(db,order.id))?.status).toBe("fulfilled");
  vi.mocked(gateway.retrieveCheckout).mockClear();expect(await processStripeEvent(db,gateway,success)).toEqual({duplicate:true});expect(gateway.retrieveCheckout).not.toHaveBeenCalled();
 }finally{sqlite.close();}
});
it("成功退款先於付款通知不發碼，較舊成功通知不能復活退款訂單",async()=>{
 const {db,sqlite,order,gateway,paid,state}=await setup();try{
  await createOrderCheckout(db,gateway,order,"https://example.test");paid();state.refunded=500;
  await processStripeEvent(db,gateway,event("evt_refund","charge.refunded","ch_charge"));
  expect((await getOrder(db,order.id))?.status).toBe("refunded");expect((await getOrder(db,order.id))?.code_id).toBeNull();
  state.refunded=0;await processStripeEvent(db,gateway,event("evt_late","checkout.session.completed","cs_test_checkout"));
  expect((await getOrder(db,order.id))?.status).toBe("refunded");
 }finally{sqlite.close();}
});
it("缺貨退款使用固定付款識別；pending 退款不當作已完成",async()=>{
 const {db,sqlite,order,gateway,paid,state}=await setup();try{
  await createOrderCheckout(db,gateway,order,"https://example.test");paid();state.refundPending=true;
  await changeCodeStatus(db,{productId:order.product_id,ids:[order.reserved_code_id],action:"revoke"});
  expect((await reconcileCheckout(db,gateway,"cs_test_checkout"))?.status).toBe("refund_pending");
  expect(gateway.createRefund).toHaveBeenCalledWith("pi_payment",order.id);
  state.refundPending=false;state.refunded=500;
  expect((await reconcileCheckout(db,gateway,"cs_test_checkout"))?.status).toBe("refunded");
 }finally{sqlite.close();}
});
it("Stripe 暫時失敗的事件可重試，錯誤金額與資料衝突不發碼",async()=>{
 const {db,sqlite,order,gateway,paid,state}=await setup();try{
  await createOrderCheckout(db,gateway,order,"https://example.test");paid();
  const notification=event("evt_retry","checkout.session.completed","cs_test_checkout");
  vi.mocked(gateway.retrieveCheckout).mockRejectedValueOnce(new Error("temporary"));
  await expect(processStripeEvent(db,gateway,notification)).rejects.toThrow("temporary");
  state.session.amount_total=100;
  await expect(processStripeEvent(db,gateway,notification)).rejects.toThrow("ORDER_PAYMENT_MISMATCH");
  expect((await getOrder(db,order.id))?.code_id).toBeNull();state.session.amount_total=500;
  await processStripeEvent(db,gateway,notification);
  await expect(processStripeEvent(db,gateway,event("evt_retry","charge.refunded","ch_other"))).rejects.toThrow("STRIPE_EVENT_CONFLICT");
 }finally{sqlite.close();}
});
it("官方 SDK 驗簽拒絕篡改或過期簽章，HTTP handler 不寫入無效事件",async()=>{
 const {db,sqlite,gateway}=await setup();try{
  const client=stripeClient("sk_test_fixture"),secret="whsec_test_fixture";
  const payload=JSON.stringify(event("evt_signed","unhandled.event","object_test"));
  const signature=client.webhooks.generateTestHeaderString({payload,secret});
  expect((await verifyStripeEvent(client,payload,signature,secret)).id).toBe("evt_signed");
  await expect(verifyStripeEvent(client,payload+" ",signature,secret)).rejects.toThrow("STRIPE_SIGNATURE_INVALID");
  const expired=client.webhooks.generateTestHeaderString({payload,secret,timestamp:1});await expect(verifyStripeEvent(client,payload,expired,secret)).rejects.toThrow("STRIPE_SIGNATURE_INVALID");
  const env={DB:db,STRIPE_SECRET_KEY:"sk_test_fixture",STRIPE_WEBHOOK_SECRET:secret};
  const invalid=new Request("https://example.test/api/stripe/webhook",{method:"POST",body:payload,headers:{"stripe-signature":"invalid"}});
  expect((await stripeWebhook(invalid,env,gateway)).status).toBe(400);expect(sqlite.prepare("SELECT count(*) AS n FROM stripe_events").get()?.n).toBe(0);
  const valid=new Request("https://example.test/api/stripe/webhook",{method:"POST",body:payload,headers:{"stripe-signature":signature}});
  expect((await stripeWebhook(valid,env,gateway)).status).toBe(200);
 }finally{sqlite.close();}
});
it("Stripe 金額轉換保留零／二／三位小數與 ISK／UGX 特例，不靜默四捨五入",()=>{
 expect(toStripeAmount(500,"USD")).toBe(500);expect(toStripeAmount(500,"JPY")).toBe(500);
 expect(toStripeAmount(5,"ISK")).toBe(500);expect(toStripeAmount(5,"UGX")).toBe(500);
 expect(fromStripeAmount(500,"UGX")).toBe(5);expect(()=>fromStripeAmount(501,"UGX")).toThrow("STRIPE_AMOUNT_UNREPRESENTABLE");
 expect(toStripeAmount(1230,"BHD")).toBe(1230);expect(()=>toStripeAmount(1234,"BHD")).toThrow("STRIPE_AMOUNT_UNREPRESENTABLE");
});
it("同事件併發租約只讓一個處理者進入，完成後重試安全",async()=>{
 const {db,sqlite,order,gateway,paid}=await setup();try{
  await createOrderCheckout(db,gateway,order,"https://example.test");paid();
  let unblock!:()=>void;const gate=new Promise<void>(resolve=>{unblock=resolve;});
  const original=gateway.retrieveCheckout;
  vi.mocked(gateway.retrieveCheckout).mockImplementationOnce(async id=>{await gate;return original(id);});
  const notification=event("evt_parallel","checkout.session.completed","cs_test_checkout");
  const first=processStripeEvent(db,gateway,notification);
  // 等待處理者已取得租約且開始 Stripe 讀取，避免把排程先後誤當併發保證。
  await vi.waitFor(()=>expect(gateway.retrieveCheckout).toHaveBeenCalled());
  await expect(processStripeEvent(db,gateway,notification)).rejects.toThrow("STRIPE_EVENT_BUSY");
  unblock();await first;expect(await processStripeEvent(db,gateway,notification)).toEqual({duplicate:true});
  expect((await getOrder(db,order.id))?.status).toBe("fulfilled");
 }finally{sqlite.close();}
});
it('折扣開關固定於 Checkout 請求；實付與退款依 Stripe 已核對小計結算',async()=>{
 const {db,sqlite,order,gateway,state,paid}=await setup();try{
  sqlite.prepare('UPDATE products SET allow_promotion_codes=1').run();
  await createOrderCheckout(db,gateway,order,'https://example.test');
  expect(vi.mocked(gateway.createCheckout).mock.calls[0][0].allow_promotion_codes).toBe(true);
  sqlite.prepare('UPDATE products SET allow_promotion_codes=0').run();
  Object.assign(state.session,{amount_subtotal:500,amount_total:300,total_details:{amount_discount:200,amount_tax:0,amount_shipping:0}});
  state.intent.amount_received=300;paid();
  expect(await reconcileCheckout(db,gateway,state.session.id)).toMatchObject({status:'fulfilled',amount_minor:500,charged_minor:300});
  state.refunded=300;
  expect(await reconcileCheckout(db,gateway,state.session.id)).toMatchObject({status:'refunded',refunded_minor:300});
 }finally{sqlite.close();}
});
it.each(['paid','no_payment_required'])('100%% 折扣（%s）只有完成的零元 Checkout 可交付，不查不存在的 PaymentIntent 或退款',async(paymentStatus)=>{
 const {db,sqlite,order,gateway,state}=await setup();try{
  sqlite.prepare('UPDATE products SET allow_promotion_codes=1').run();
  await createOrderCheckout(db,gateway,order,'https://example.test');
  Object.assign(state.session,{amount_subtotal:500,amount_total:0,total_details:{amount_discount:500,amount_tax:0,amount_shipping:0},payment_intent:null,payment_status:paymentStatus});
  expect((await reconcileCheckout(db,gateway,state.session.id))?.paid_at).toBeNull();
  state.session.status='complete';
  state.session.payment_status='unpaid';
  expect((await reconcileCheckout(db,gateway,state.session.id))?.paid_at).toBeNull();
  state.session.payment_status=paymentStatus;
  Object.assign(state.session,{payment_intent:'pi_unexpected'});
  await expect(reconcileCheckout(db,gateway,state.session.id)).rejects.toThrow('ORDER_PAYMENT_MISMATCH');
  Object.assign(state.session,{payment_intent:null});
  expect(await reconcileCheckout(db,gateway,state.session.id)).toMatchObject({status:'fulfilled',charged_minor:0,payment_intent_id:null});
  const firstCode=(await getOrder(db,order.id))?.code_id;
  expect((await reconcileCheckout(db,gateway,state.session.id))?.code_id).toBe(firstCode);
  expect(gateway.retrievePaymentIntent).not.toHaveBeenCalled();expect(gateway.succeededRefundAmount).not.toHaveBeenCalled();expect(gateway.createRefund).not.toHaveBeenCalled();
 }finally{sqlite.close();}
});
it('拒絕未開放折扣、錯誤小計、額外稅費或不符實付的付款',async()=>{
 const {db,sqlite,order,gateway,state,paid}=await setup();try{
  await createOrderCheckout(db,gateway,order,'https://example.test');paid();
  Object.assign(state.session,{amount_subtotal:500,amount_total:300,total_details:{amount_discount:200,amount_tax:0,amount_shipping:0}});state.intent.amount_received=300;
  await expect(reconcileCheckout(db,gateway,state.session.id)).rejects.toThrow('ORDER_PAYMENT_MISMATCH');
  sqlite.prepare("UPDATE orders SET checkout_payload_json=json_set(checkout_payload_json,'$.allow_promotion_codes',json('true'))").run();
  for(const patch of [{amount_subtotal:400},{total_details:{amount_discount:200,amount_tax:1,amount_shipping:0}},{amount_total:299}]){
   const original={...state.session};Object.assign(state.session,patch);
   await expect(reconcileCheckout(db,gateway,state.session.id)).rejects.toThrow('ORDER_PAYMENT_MISMATCH');Object.assign(state.session,original);
  }
  state.intent.amount_received=500;
  await expect(reconcileCheckout(db,gateway,state.session.id)).rejects.toThrow('ORDER_PAYMENT_MISMATCH');
  expect((await getOrder(db,order.id))?.paid_at).toBeNull();
 }finally{sqlite.close();}
});
it('關聯 Stripe 商品保持 Keydrop 價格，重試沿用原商品並拒絕無效來源',async()=>{
 const {db,sqlite,order,gateway}=await setup();try{
  sqlite.prepare("UPDATE products SET stripe_product_id='prod_linked'").run();
  gateway.retrieveProduct=vi.fn(async id=>({id,object:'product',active:true}));
  await createOrderCheckout(db,gateway,order,'https://example.test');
  const payload=vi.mocked(gateway.createCheckout).mock.calls[0][0];
  expect(payload.line_items?.[0]?.price_data).toEqual({currency:'usd',unit_amount:500,product:'prod_linked'});
  sqlite.prepare("UPDATE products SET stripe_product_id='prod_changed'").run();
  sqlite.prepare('UPDATE orders SET checkout_session_id=NULL').run();
  await createOrderCheckout(db,gateway,order,'https://example.test');
  expect(vi.mocked(gateway.createCheckout).mock.calls[1][0]).toEqual(payload);
  expect(gateway.retrieveProduct).toHaveBeenLastCalledWith('prod_linked');
  vi.mocked(gateway.retrieveProduct).mockResolvedValueOnce({id:'prod_linked',object:'product',active:false});
  await expect(createOrderCheckout(db,gateway,order,'https://example.test')).rejects.toThrow('STRIPE_PRODUCT_UNAVAILABLE');
  vi.mocked(gateway.retrieveProduct).mockRejectedValueOnce(new Error('private Stripe error'));
  await expect(createOrderCheckout(db,gateway,order,'https://example.test')).rejects.toThrow('STRIPE_PRODUCT_UNAVAILABLE');
  expect(gateway.createCheckout).toHaveBeenCalledTimes(2);
 }finally{sqlite.close();}
});
