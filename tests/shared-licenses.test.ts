import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {createCampaign,setCampaignStatus} from '../src/lib/server/campaigns';
import {publicCampaign} from '../src/lib/server/public-campaigns';
import {claimCode,type ClaimServices} from '../src/lib/server/claims';
import {activateLicense,validateLicense,releaseOwnedDevice,listOwnedDevices,releaseLicense} from '../src/lib/server/licenses';
import {reserveOrder,attachCheckout,settleOrder,refundOrder} from '../src/lib/server/orders';
import {createApiToken} from '../src/lib/server/api-tokens';
import {authenticatedApiOperation} from '../src/lib/server/api-operations';
const secret='ab'.repeat(32),identity='fixture-identity-at-least-32-characters';
const services:ClaimServices={encryptionSecret:secret,identitySecret:identity,purchasedCount:async()=>0,qualify:async()=>({allowed:false})};
async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 for(const user of ['a','b','stranger'])sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,0,0)').run(user,user,`${user}@example.test`);
 const p=await createProduct(db,{name:'Shared license',slug:'license',priceMinor:500});
 const b=await createBatch(db,secret,{productId:p.id,name:'Licenses',kind:'license',source:'manual',codes:['SHARED-LICENSE'],distributionMode:'shared',maxDevices:1});
 const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:'Free',slug:'free',conditions:{type:'always'}});await setCampaignStatus(db,c.id,1,'active');
 const claim=(userId:string)=>claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId,emailVerified:false},services);
 const input={productId:p.id,code:'SHARED-LICENSE',deviceId:'same-device'};
 const activate=(userId:string,deviceId='same-device')=>activateLicense(db,secret,identity,{...input,deviceId},Date.now(),userId);
 const proof=(token:string,deviceId='same-device')=>({productId:p.id,activationToken:token,deviceId});
 return {...database,p,b,c,claim,input,activate,proof};
}
it('共用啟用碼要求具名持有者，輸入 userId 不能冒充伺服器身分',async()=>{
 const {db,sqlite,c,input,claim,activate}=await setup();try{
  expect(await publicCampaign(db,'free')).toMatchObject({authMode:'account'});
  await expect(claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{browserId:'browser',ipAddress:'192.0.2.1',emailVerified:false},services)).rejects.toThrow('CLAIM_LOGIN_REQUIRED');
  await expect(claim('missing-user')).rejects.toThrow('CLAIM_LOGIN_REQUIRED');
  await claim('a');
  await expect(activateLicense(db,secret,identity,input)).rejects.toThrow('LICENSE_OWNER_REQUIRED');
  await expect(activateLicense(db,secret,identity,{...input,userId:'a'})).rejects.toThrow();
  await expect(activate('stranger')).rejects.toThrow('LICENSE_OWNER_REQUIRED');
  expect(await activate('a')).toHaveProperty('activationToken');
 }finally{sqlite.close();}
});
it('同碼同裝置 ID 依帳號隔離，各有裝置上限且無法列出或解除別人的裝置',async()=>{
 const {db,sqlite,claim,activate,proof}=await setup();try{
  await claim('a');await claim('b');
  const a=await activate('a'),b=await activate('b');expect(a.activationId).not.toBe(b.activationId);expect(a.activationToken).not.toBe(b.activationToken);
  expect(await activate('a')).toEqual(a);
  await expect(activate('a','second')).rejects.toThrow('LICENSE_ACTIVATION_UNAVAILABLE');
  expect((await listOwnedDevices(db,'a')).map(d=>d.id)).toEqual([a.activationId]);
  await expect(releaseOwnedDevice(db,b.activationId,'a')).rejects.toThrow('LICENSE_DEVICE_NOT_FOUND');
  await releaseOwnedDevice(db,a.activationId,'a');
  expect((await validateLicense(db,identity,proof(a.activationToken))).valid).toBe(false);
  expect((await validateLicense(db,identity,proof(b.activationToken))).valid).toBe(true);
  const again=await activate('a');expect(again.activationToken).not.toBe(a.activationToken);
  await expect(validateLicense(db,identity,proof(a.activationToken))).rejects.toThrow('INVALID_LICENSE_PROOF');
  await releaseLicense(db,identity,proof(again.activationToken));
  expect((await validateLicense(db,identity,proof(b.activationToken))).valid).toBe(true);
 }finally{sqlite.close();}
});
it('同一持有人競爭最後裝置名額不超發，其他持有人不受限',async()=>{
 const {sqlite,claim,activate}=await setup();try{
  await claim('a');await claim('b');
  const results=await Promise.allSettled([activate('a','first'),activate('a','second')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(await activate('b')).toHaveProperty('activationId');
 }finally{sqlite.close();}
});
it('共用購買退款只解除失去持有權的帳號，其他人與免費來源保留',async()=>{
 for(const alsoFree of [false,true]){
  const {db,sqlite,p,b,claim,activate,proof}=await setup();try{
   const order=await reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:'a',userId:'a',idempotencyKey:crypto.randomUUID()});
   await attachCheckout(db,order.id,'cs_test');await settleOrder(db,{orderId:order.id,sessionId:'cs_test',paymentIntentId:'pi_test',amountMinor:500,currency:'USD'});
   await claim('b');if(alsoFree)await claim('a');
   const a=await activate('a'),other=await activate('b');
   await refundOrder(db,'pi_test',500);
   expect((await validateLicense(db,identity,proof(a.activationToken))).valid).toBe(alsoFree);
   expect((await validateLicense(db,identity,proof(other.activationToken))).valid).toBe(true);
   if(!alsoFree){await expect(activate('a')).rejects.toThrow('LICENSE_OWNER_REQUIRED');await claim('a');const again=await activate('a');expect(again.activationToken).not.toBe(a.activationToken);}
  }finally{sqlite.close();}
 }
});
it('產品後端能用授權 API 委派啟用，但不能繞過商品範圍或持有關係',async()=>{
 const {db,sqlite,p,claim,input,proof}=await setup();try{
  await claim('a');const token=await createApiToken(db,{name:'License server',scopes:['licenses:manage'],productIds:[p.id]});
  const request={action:'licenses.activate',...input,userId:'a'};const context={claims:services};
  const result=await authenticatedApiOperation(db,`Bearer ${token.token}`,request,context) as {activationToken:string};
  expect((await validateLicense(db,identity,proof(result.activationToken))).valid).toBe(true);
  await expect(authenticatedApiOperation(db,`Bearer ${token.token}`,{...request,userId:'stranger'},context)).rejects.toThrow('LICENSE_OWNER_REQUIRED');
  await expect(authenticatedApiOperation(db,`Bearer ${token.token}`,{...request,productId:crypto.randomUUID()},context)).rejects.toThrow('API_SCOPE_DENIED');
 }finally{sqlite.close();}
});
it('MCP 委派共用啟用需要額外寫入授權，實際憑證可查驗',async()=>{
 const {handleMcpRequest}=await import('../src/lib/server/mcp');
 const {db,sqlite,p,claim,input,proof}=await setup();try{
  await claim('a');const appUrl='https://keydrop.example';
  for(const enabled of [false,true]){
   const token=await createApiToken(db,{name:'MCP license',scopes:['licenses:manage'],productIds:[p.id],mcpWriteEnabled:enabled});
   const request=new Request(`${appUrl}/mcp`,{method:'POST',headers:{Authorization:`Bearer ${token.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'activate_license_device',arguments:{...input,userId:'a'}}})});
   const response=await handleMcpRequest(request,{db,appUrl,identitySecret:identity,services:{claims:services}});
   const body=await response.json() as {result?:{structuredContent?:{activationToken:string};isError?:boolean};error?:unknown};
   if(enabled){expect(body.result?.structuredContent).toHaveProperty('activationToken');expect((await validateLicense(db,identity,proof(body.result!.structuredContent!.activationToken))).valid).toBe(true);}
   else{expect(body.result?.isError||body.error).toBeTruthy();expect(sqlite.prepare('SELECT count(*) n FROM license_devices').get()?.n).toBe(0);}
  }
 }finally{sqlite.close();}
});
it('共用裝置升級保留獨立碼的既有裝置，不要求補綁帳號',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {readFileSync,readdirSync}=await import('node:fs');
 const sqlite=new DatabaseSync(':memory:');try{
  sqlite.exec('PRAGMA foreign_keys=ON');const directory=new URL('../migrations/',import.meta.url);
  for(const file of readdirSync(directory).filter(name=>name.endsWith('.sql')&&name<'0021').sort())sqlite.exec(readFileSync(new URL(file,directory),'utf8'));
  sqlite.exec(`INSERT INTO products(id,name,slug,created_at,updated_at) VALUES('p','Product','p',1,1);
   INSERT INTO code_batches(id,product_id,name,kind,source,created_at) VALUES('b','p','Batch','license','manual',1);
   INSERT INTO codes(id,product_id,batch_id,fingerprint,ciphertext,created_at) VALUES('k','p','b','hash','encrypted',1);
   INSERT INTO license_devices(id,code_id,device_hash,token_hash,token_ciphertext,activated_at) VALUES('d','k','device','token','encrypted-token',2);`);
  const before=sqlite.prepare('SELECT * FROM license_devices').get()!;
  sqlite.exec(readFileSync(new URL('0021_shared_licenses.sql',directory),'utf8'));
  expect(sqlite.prepare('SELECT * FROM license_devices').get()).toEqual({...before,user_id:null});
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  sqlite.exec("UPDATE license_devices SET label='updated' WHERE id='d'");
  expect(sqlite.prepare('SELECT label,released_at FROM license_devices').get()).toEqual({label:'updated',released_at:null});
 }finally{sqlite.close();}
});
