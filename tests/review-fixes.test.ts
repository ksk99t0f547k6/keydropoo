// 2026-11-08 審查修正的回歸測試：庫存鎖定、預留到期、Stripe 刷新、領碼上限、外部權益名額。
import {describe,expect,it,vi} from "vitest";
import type Stripe from "stripe";
import {testDatabase} from "./d1";
import {createProduct,createBatch} from "../src/lib/server/inventory";
import {createCampaign,setCampaignStatus} from "../src/lib/server/campaigns";
import {claimCode,linkGuestClaim,type ClaimServices} from "../src/lib/server/claims";
import {clientNetwork} from "../src/lib/server/claim-identity";
import {reserveOrder,attachCheckout,settleOrder,getOrder,expireReservations,PENDING_ORDERS_PER_BUYER,PENDING_ORDERS_PER_NETWORK,RESERVATION_MS,WEBHOOK_GRACE_MS} from "../src/lib/server/orders";
import {maintainOrders} from "../src/lib/server/order-maintenance";
import {processStripeEvent,type StripeGateway} from "../src/lib/server/stripe";
import {pullStripeDiscount} from "../src/lib/server/stripe-discount-catalog";
import {importStripePromotion} from "../src/lib/server/stripe-inventory";
import type {StripeCouponSnapshot,StripePromotionSnapshot} from "../src/lib/server/stripe-discounts";
import {saveRewardRule,redeemCode} from "../src/lib/server/redemptions";

const secret="ab".repeat(32);

async function salesSetup(codes=["SALE-1","SALE-2","SALE-3","SALE-4","SALE-5","SALE-6","SALE-7","SALE-8"]){
  const database=testDatabase();const {db}=database;
  const product=await createProduct(db,{name:"App",slug:"app",priceMinor:500,currency:"USD",shortagePolicy:"refund"});
  const batch=await createBatch(db,secret,{productId:product.id,name:"Sales",kind:"redemption",source:"manual",codes});
  const reserve=(buyerKey:string,ipKey:string|null,now=1000)=>reserveOrder(db,{productId:product.id,batchId:batch.id,buyerKey,ipKey,idempotencyKey:crypto.randomUUID()},now);
  return {...database,product,batch,reserve};
}

describe("未付款預留上限（庫存不能被鎖光）",()=>{
  it("同一買家與同一網段的未付款預留有上限，超過回 ORDER_PENDING_LIMIT 且不佔庫存",async()=>{
    const {sqlite,reserve}=await salesSetup();try{
      for(let i=0;i<PENDING_ORDERS_PER_BUYER;i++)await reserve("buyer-a","net-1");
      await expect(reserve("buyer-a","net-1")).rejects.toThrow("ORDER_PENDING_LIMIT");
      // 換新的匿名 cookie（新 buyerKey）仍受同網段上限限制。
      for(let i=PENDING_ORDERS_PER_BUYER;i<PENDING_ORDERS_PER_NETWORK;i++)await reserve(`buyer-${i}`,"net-1");
      await expect(reserve("buyer-new","net-1")).rejects.toThrow("ORDER_PENDING_LIMIT");
      expect(sqlite.prepare("SELECT count(*) n FROM codes WHERE status='reserved'").get()?.n).toBe(PENDING_ORDERS_PER_NETWORK);
      // 其他網段不受影響。
      await reserve("buyer-x","net-2");
      // 35 分鐘後舊預留不再計入上限。
      await reserve("buyer-a","net-1",1000+RESERVATION_MS+1);
    }finally{sqlite.close();}
  });
  it("真的缺貨時仍回 ORDER_STOCK_UNAVAILABLE",async()=>{
    const {sqlite,reserve}=await salesSetup(["ONLY"]);try{
      await reserve("buyer-a","net-1");
      await expect(reserve("buyer-b","net-2")).rejects.toThrow("ORDER_STOCK_UNAVAILABLE");
    }finally{sqlite.close();}
  });
});

describe("Session 建立後的預留到期",()=>{
  it("附加 Session 延長預留；原本 35 分鐘到期時不釋放，晚到的付款拿到自己預留的碼",async()=>{
    const {db,sqlite,reserve}=await salesSetup(["MINE","OTHER"]);try{
      const order=await reserve("buyer-a","net-1");
      await attachCheckout(db,order.id,"cs_test_late");
      await attachCheckout(db,order.id,"cs_test_late");
      const attached=(await getOrder(db,order.id))!;
      // 重複附加同一個 Session 只延長一次。
      expect(attached.reserved_until).toBe(order.reserved_until+WEBHOOK_GRACE_MS);
      expect((await maintainOrders(db,order.reserved_until+60000)).expired).toBe(0);
      const other=await reserve("buyer-b","net-2",order.reserved_until+60000);
      expect(other.reserved_code_id).not.toBe(order.reserved_code_id);
      const paid=await settleOrder(db,{orderId:order.id,sessionId:"cs_test_late",paymentIntentId:"pi_late",amountMinor:500,currency:"USD"},order.reserved_until+120000);
      expect(paid.status).toBe("fulfilled");expect(paid.code_id).toBe(order.reserved_code_id);
    }finally{sqlite.close();}
  });
  it("沒有 Session 的預留仍在 35 分鐘後釋放",async()=>{
    const {db,sqlite,reserve}=await salesSetup(["ONLY"]);try{
      const order=await reserve("buyer-a","net-1");
      expect((await expireReservations(db,order.reserved_until)).expired).toBe(1);
      expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("available");
    }finally{sqlite.close();}
  });
  it("非同步付款等待期間延長預留，async_payment_failed 立即釋放",async()=>{
    const {db,sqlite,reserve}=await salesSetup(["ONLY"]);try{
      const order=await reserve("buyer-a","net-1");
      await attachCheckout(db,order.id,"cs_test_async");
      const session={id:"cs_test_async",metadata:{keydrop_order_id:order.id},client_reference_id:order.id,status:"complete",payment_status:"unpaid",payment_intent:"pi_async",amount_total:500,currency:"usd",url:null};
      const gateway={retrieveCheckout:vi.fn(async()=>session)} as unknown as StripeGateway;
      const event=(id:string,type:string)=>({id,type,livemode:false,data:{object:{id:session.id}}}) as unknown as Stripe.Event;
      const now=order.reserved_until+1000;
      await processStripeEvent(db,gateway,event("evt_completed","checkout.session.completed"),now);
      const waiting=(await getOrder(db,order.id))!;
      expect(waiting.status).toBe("pending");expect(waiting.reserved_until).toBeGreaterThanOrEqual(now+13*86400000);
      await processStripeEvent(db,gateway,event("evt_failed","checkout.session.async_payment_failed"),now+1000);
      expect((await getOrder(db,order.id))!.status).toBe("expired");
      expect(sqlite.prepare("SELECT status FROM codes").get()?.status).toBe("available");
    }finally{sqlite.close();}
  });
});

describe("Stripe 折扣例行刷新",()=>{
  const scope={accountId:"acct_fixture",livemode:false};
  const coupon:StripeCouponSnapshot={id:"coupon_fixture",object:"coupon",livemode:false,valid:true,name:null,amount_off:null,percent_off:25,currency:null,duration:"once",duration_in_months:null,max_redemptions:null,times_redeemed:0,redeem_by:null};
  const promotion:StripePromotionSnapshot={id:"promo_fixture",object:"promotion_code",livemode:false,active:true,code:"STRIPE-REFRESH",promotion:{type:"coupon",coupon:coupon.id},customer:null,customer_account:null,expires_at:null,max_redemptions:null,times_redeemed:0,restrictions:{first_time_transaction:false,minimum_amount:null,minimum_amount_currency:null}};
  it("刷新進行中沿用上次成功的快照；刷新失敗才排除",async()=>{
    const database=testDatabase();const {db,sqlite}=database;try{
      const product=await createProduct(db,{name:"Stripe",slug:"stripe",priceMinor:500});
      let release:()=>void=()=>{};
      const api={retrieveCoupon:vi.fn(async()=>coupon),retrievePromotion:vi.fn(async()=>promotion)};
      await pullStripeDiscount(db,secret,api,{...scope,kind:"coupon",sourceId:coupon.id});
      await pullStripeDiscount(db,secret,api,{...scope,kind:"promotion_code",sourceId:promotion.id});
      await importStripePromotion(db,secret,scope,{productId:product.id,promotionId:promotion.id,name:"Imported",distributionMode:"shared",sharedClaimLimit:10});
      const unavailable=()=>Number(sqlite.prepare("SELECT count(*) n FROM stripe_unavailable_codes").get()?.n);
      expect(unavailable()).toBe(0);
      api.retrievePromotion.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve(promotion);}));
      const inFlight=pullStripeDiscount(db,secret,api,{...scope,kind:"promotion_code",sourceId:promotion.id});
      await vi.waitFor(()=>expect(api.retrievePromotion).toHaveBeenCalledTimes(2));
      expect(unavailable()).toBe(0);
      release();await inFlight;
      api.retrievePromotion.mockRejectedValueOnce(new Error("network"));
      await expect(pullStripeDiscount(db,secret,api,{...scope,kind:"promotion_code",sourceId:promotion.id})).rejects.toThrow("STRIPE_SYNC_FAILED");
      expect(unavailable()).toBe(1);
    }finally{sqlite.close();}
  });
});

describe("領碼上限",()=>{
  const services:ClaimServices={encryptionSecret:secret,identitySecret:"test-identity-secret-32-characters-long",purchasedCount:async()=>0,qualify:async()=>({allowed:false}),now:()=>1000};
  async function campaignSetup(authMode:"anonymous"|"account",perPersonLimit=1,count=10){
    const database=testDatabase();const {db}=database;
    const p=await createProduct(db,{name:"App",slug:"app"});
    const b=await createBatch(db,secret,{productId:p.id,name:"Launch",kind:"external",source:"manual",codes:Array.from({length:count},(_,i)=>`code-${i}`)});
    const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:"Launch",slug:"launch",conditions:{type:"always"},authMode,perPersonLimit});
    await setCampaignStatus(db,c.id,1,"active");
    const addUser=(id:string,verified=1)=>database.sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run(id,id,`${id}@example.test`,verified);
    return {...database,c,addUser};
  }
  it("IPv6 截成 /64，IPv4 與對映位址維持原樣",()=>{
    expect(clientNetwork("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(clientNetwork("2001:db8:1:2::1")).toBe(clientNetwork("2001:0db8:0001:0002:ffff::9"));
    expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
    expect(clientNetwork("203.0.113.9")).toBe("203.0.113.9");
    expect(clientNetwork("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(clientNetwork("2001:DB8:1:2::1")).toBe("2001:db8:1:2::/64");
  });
  it("未驗證信箱的帳號經公開路由領取時受網段上限；已驗證信箱不受限",async()=>{
    const {db,sqlite,c}=await campaignSetup("account");try{
      const claim=(userId:string,emailVerified:boolean,ipAddress?:string)=>claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId,email:`${userId}@example.test`,emailVerified,ipAddress},services);
      await claim("fake-1",false,"net-a");
      await expect(claim("fake-2",false,"net-a")).rejects.toThrow("CLAIM_UNAVAILABLE");
      await claim("real-1",true,"net-a");await claim("real-2",true,"net-a");
      // API／MCP 代發沒有來源 IP，不套用網段上限。
      await claim("api-user",false);
    }finally{sqlite.close();}
  });
  it("匿名領取綁定帳號時不能超過每人上限，超過的紀錄維持匿名",async()=>{
    const {db,sqlite,c,addUser}=await campaignSetup("anonymous");try{
      addUser("owner");
      const guest=(browserId:string,ip:string)=>claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{emailVerified:false,browserId,ipAddress:ip},services);
      const b1=crypto.randomUUID(),b2=crypto.randomUUID();
      const first=await guest(b1,"net-1"),second=await guest(b2,"net-2");
      expect(await linkGuestClaim(db,first.id,b1,"owner",services.identitySecret)).toEqual({linked:true});
      await expect(linkGuestClaim(db,second.id,b2,"owner",services.identitySecret)).rejects.toThrow("CLAIM_LINK_LIMIT_REACHED");
      expect(sqlite.prepare("SELECT count(*) n FROM claims WHERE user_id='owner'").get()?.n).toBe(1);
      expect(sqlite.prepare("SELECT user_id FROM claims WHERE id=?").get(second.id)?.user_id).toBeNull();
    }finally{sqlite.close();}
  });
});

describe("外部權益明確拒絕後的名額",()=>{
  it("明確拒絕釋放兌換名額給其他人；被拒的人之後重試會因名額用完而拒絕，不重送",async()=>{
    const database=testDatabase();const {db,sqlite}=database;try{
      const p=await createProduct(db,{name:"External",slug:"external",priceMinor:500});
      const b=await createBatch(db,secret,{productId:p.id,name:"Codes",kind:"redemption",source:"manual",codes:["KEY-A"]});
      await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:"external",integrationId:"partner",payload:{plan:"pro"}}});
      const raw=()=>({productId:p.id,code:"KEY-A",idempotencyKey:crypto.randomUUID()});
      const dispatch=vi.fn(async(_id:string,value:{operationId:string})=>({operationId:value.operationId,status:"rejected" as const}));
      await expect(redeemCode(db,"rejected-user",raw(),Date.now(),dispatch)).rejects.toThrow("EXTERNAL_REDEMPTION_FAILED");
      const applied=vi.fn(async(_id:string,value:{operationId:string})=>({operationId:value.operationId,status:"applied" as const}));
      await redeemCode(db,"other-user",raw(),Date.now(),applied);
      expect(sqlite.prepare("SELECT use_count FROM codes").get()?.use_count).toBe(1);
      dispatch.mockClear();
      await expect(redeemCode(db,"rejected-user",raw(),Date.now(),dispatch)).rejects.toThrow("REDEMPTION_UNAVAILABLE");
      expect(dispatch).not.toHaveBeenCalled();
    }finally{sqlite.close();}
  });
});
