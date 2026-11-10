import {it,expect} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {createWebhookEndpoint,listWebhookEndpoints,setWebhookEnabled,listWebhookDeliveries,retryWebhookDelivery} from "../src/lib/server/webhook-management";
import {deliverWebhookOutbox} from "../src/lib/server/webhook-outbox";
const secret='ab'.repeat(32);
it('新端點預設停用、驗證來源與明確商品範圍，啟用必須已配置密鑰',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  const input={name:'Integration',url:'https://example.com/events',secretName:'PARTNER',events:['code.revoked'],productIds:[p.id]};
  await expect(createWebhookEndpoint(db,{...input,url:'http://127.0.0.1'})).rejects.toThrow('WEBHOOK_URL_INVALID');
  await expect(createWebhookEndpoint(db,{...input,productIds:[]})).rejects.toThrow();
  await expect(createWebhookEndpoint(db,{...input,productIds:[crypto.randomUUID()]})).rejects.toThrow('WEBHOOK_PRODUCTS_INVALID');
  const endpoint=await createWebhookEndpoint(db,input);expect(endpoint.enabled).toBe(false);
  await expect(setWebhookEnabled(db,endpoint.id,true,{})).rejects.toThrow('WEBHOOK_SECRET_MISSING');
  await setWebhookEnabled(db,endpoint.id,true,{PARTNER:secret});
  const rows=await listWebhookEndpoints(db);expect(rows[0]).toMatchObject({id:endpoint.id,enabled:1,events:['code.revoked'],productIds:[p.id]});
  expect(JSON.stringify(rows)).not.toContain(secret);
  await setWebhookEnabled(db,endpoint.id,false,{});
  expect((await listWebhookEndpoints(db))[0].enabled).toBe(0);
 }finally{sqlite.close();}
});
it('人工重試只允許失敗且啟用的原端點，保留累積嘗試紀錄',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  await createBatch(db,secret,{productId:p.id,name:'Codes',kind:'external',source:'manual',codes:['fixture']});
  const code=sqlite.prepare('SELECT id FROM codes').get()!.id as string;
  const input={name:'Integration',url:'https://example.com/events',secretName:'PARTNER',events:['code.revoked'],productIds:null};
  const endpoint=await createWebhookEndpoint(db,input),other=await createWebhookEndpoint(db,input);
  await setWebhookEnabled(db,endpoint.id,true,{PARTNER:secret});
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:'revoke'});
  const listing=await listWebhookDeliveries(db,{endpointId:endpoint.id});expect(listing.total).toBe(1);
  const id=listing.deliveries[0].id as string;
  await expect(retryWebhookDelivery(db,endpoint.id,id)).rejects.toThrow('WEBHOOK_RETRY_UNAVAILABLE');
  sqlite.prepare("UPDATE webhook_deliveries SET status='failed',attempts=8,total_attempts=8").run();
  await expect(retryWebhookDelivery(db,other.id,id)).rejects.toThrow('WEBHOOK_RETRY_UNAVAILABLE');
  await setWebhookEnabled(db,endpoint.id,false,{});
  await expect(retryWebhookDelivery(db,endpoint.id,id)).rejects.toThrow('WEBHOOK_RETRY_UNAVAILABLE');
  await setWebhookEnabled(db,endpoint.id,true,{PARTNER:secret});
  expect(await retryWebhookDelivery(db,endpoint.id,id)).toEqual({queued:true});
  await expect(retryWebhookDelivery(db,endpoint.id,id)).rejects.toThrow('WEBHOOK_RETRY_UNAVAILABLE');
  await deliverWebhookOutbox(db,async()=>204,Date.now()+1000);
  expect((await listWebhookDeliveries(db,{endpointId:endpoint.id})).deliveries[0]).toMatchObject({status:'delivered',attempts:1,total_attempts:9,retry_count:1});
  await expect(retryWebhookDelivery(db,endpoint.id,id)).rejects.toThrow('WEBHOOK_RETRY_UNAVAILABLE');
 }finally{sqlite.close();}
});
