import {expect,it} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus} from '../src/lib/server/inventory';
import {assignCode,listAssignments} from '../src/lib/server/assignments';
import {listMyCodes} from '../src/lib/server/my-codes';
import {queueAutomaticCodeEmails,deliverCodeEmails} from '../src/lib/server/code-email';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import {activateLicense,releaseOwnedDevice,validateLicense} from '../src/lib/server/licenses';
import {reserveOrder} from '../src/lib/server/orders';
const secret='ab'.repeat(32),identity='test-identity-secret-32-characters-long';
async function setup(kind='redemption',shared=false){
 const data=testDatabase(),{db,sqlite}=data;
 for(const id of ['admin','a','b','c'])sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run(id,id,`${id}@example.test`,1,0,0);
 sqlite.prepare('INSERT INTO installation(id,admin_user_id,created_at) VALUES(1,?,0)').run('admin');
 const p=await createProduct(db,{name:'Assignment',slug:'assignment',priceMinor:500});
 const batch=await createBatch(db,secret,{productId:p.id,name:'Manual',kind,source:'manual',codes:['ASSIGN-CODE'],...(shared?{distributionMode:'shared',sharedClaimLimit:2,maxUses:10}:{})});
 const codeId=String(sqlite.prepare('SELECT id FROM codes WHERE batch_id=?').get(batch.id)!.id);
 const input=(email='a@example.test')=>({productId:p.id,codeId,email,note:'Customer support delivery',idempotencyKey:crypto.randomUUID()});
 return {...data,p,batch,codeId,input};
}
it('指派與重送原子去重，拒絕其他管理身分；持有人、通知與操作紀錄同步',async()=>{
 const {db,sqlite,p,input,codeId}=await setup();try{
  const raw=input();await expect(assignCode(db,'a',raw)).rejects.toThrow('ASSIGNMENT_FORBIDDEN');
  const both=await Promise.all([assignCode(db,'admin',raw),assignCode(db,'admin',raw)]);expect(both[0]).toEqual(both[1]);
  await expect(assignCode(db,'admin',{...raw,note:'Different'})).rejects.toThrow('ASSIGNMENT_CONFLICT');
  await expect(assignCode(db,'admin',input('b@example.test'))).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  expect((await listMyCodes(db,secret,'a')).items[0]).toMatchObject({code:'ASSIGN-CODE',source:'assignment'});
  expect((await listMyCodes(db,secret,'b')).total).toBe(0);
  expect((await listAssignments(db,{productId:p.id})).items[0]).toMatchObject({code_id:codeId,note:raw.note,assigned_by:'admin'});
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:1});
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_events WHERE type='code.assigned'").get()?.n).toBe(1);
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM code_assignments').all())).not.toContain('ASSIGN-CODE');
 }finally{sqlite.close();}
});
it('指派的兌換碼只允許持有人使用批次權益；撤銷後回收並取消寄信',async()=>{
 const {db,sqlite,p,batch,input}=await setup();try{
  await saveRewardRule(db,{productId:p.id,batchId:batch.id,expectedVersion:0,reward:{kind:'credits',bucket:'tokens',amount:100,repeat:'add',reclaimOnRevoke:true}});
  await assignCode(db,'admin',input());
  const redeem=()=>({productId:p.id,code:'ASSIGN-CODE',idempotencyKey:crypto.randomUUID()});
  await expect(redeemCode(db,'b',redeem())).rejects.toThrow('REDEMPTION_UNAVAILABLE');
  await redeemCode(db,'a',redeem());
  expect(sqlite.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get('a')?.balance).toBe(100);
  await queueAutomaticCodeEmails(db);
  await changeCodeStatus(db,{productId:p.id,ids:[input().codeId],action:'revoke'});
  expect(sqlite.prepare('SELECT balance FROM credit_wallets WHERE user_id=?').get('a')?.balance).toBe(0);
  let sends=0;expect(await deliverCodeEmails(db,{sender:{send:async()=>{sends++;}},from:'test@example.test',encryptionSecret:secret},Date.now()+1000)).toEqual({sent:0,cancelled:1});expect(sends).toBe(0);
 }finally{sqlite.close();}
});
it('共用指派與付款共用名額，裝置只允許持有人管理',async()=>{
 const {db,sqlite,p,batch,input}=await setup('license',true);try{
  await assignCode(db,'admin',input());
  await assignCode(db,'admin',input('b@example.test'));
  await expect(assignCode(db,'admin',input('c@example.test'))).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  await expect(reserveOrder(db,{productId:p.id,batchId:batch.id,buyerKey:'buyer',userId:'c',idempotencyKey:crypto.randomUUID()})).rejects.toThrow('ORDER_STOCK_UNAVAILABLE');
  const raw={productId:p.id,code:'ASSIGN-CODE',deviceId:'device-a'};
  await expect(activateLicense(db,secret,identity,raw,Date.now(),'c')).rejects.toThrow('LICENSE_OWNER_REQUIRED');
  const active=await activateLicense(db,secret,identity,raw,Date.now(),'a');
  await expect(releaseOwnedDevice(db,active.activationId,'b')).rejects.toThrow('LICENSE_DEVICE_NOT_FOUND');
  await releaseOwnedDevice(db,active.activationId,'a');
  expect((await validateLicense(db,identity,{productId:p.id,deviceId:'device-a',activationToken:active.activationToken})).valid).toBe(false);
 }finally{sqlite.close();}
});
it('已保留、到期、封存與不存在收件帳號不得指派',async()=>{
 const {db,sqlite,p,input,codeId}=await setup();try{
  await expect(assignCode(db,'admin',input('missing@example.test'))).rejects.toThrow('ASSIGNMENT_USER_NOT_FOUND');
  sqlite.prepare("UPDATE codes SET status='reserved'").run();await expect(assignCode(db,'admin',input())).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  sqlite.prepare("UPDATE codes SET status='available',expires_at=1").run();await expect(assignCode(db,'admin',input())).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  sqlite.prepare('UPDATE codes SET expires_at=NULL').run();sqlite.prepare('UPDATE products SET archived_at=1 WHERE id=?').run(p.id);
  await expect(assignCode(db,'admin',input())).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  expect(sqlite.prepare('SELECT count(*) n FROM code_assignments WHERE code_id=?').get(codeId)?.n).toBe(0);
 }finally{sqlite.close();}
});

it('指派與 Checkout 競爭最後一碼只允許一方取得庫存',async()=>{
 const {db,sqlite,p,batch,input}=await setup('external');try{
  const results=await Promise.allSettled([
   assignCode(db,'admin',input()),
   reserveOrder(db,{productId:p.id,batchId:batch.id,buyerKey:'buyer',userId:'b',idempotencyKey:crypto.randomUUID()}),
  ]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(sqlite.prepare("SELECT (SELECT count(*) FROM code_assignments)+(SELECT count(*) FROM orders WHERE status='pending') n").get()?.n).toBe(1);
 }finally{sqlite.close();}
});

it('外部權益的持有權檢查也納入直接指派，未授權不呼叫接收端',async()=>{
 const {db,sqlite,p,batch,input}=await setup();try{
  await saveRewardRule(db,{productId:p.id,batchId:batch.id,expectedVersion:0,reward:{kind:'external',integrationId:'partner',payload:{plan:'pro'}}});
  await assignCode(db,'admin',input());
  let sends=0;
  const dispatch:import('../src/lib/server/external-redemptions').ExternalDispatcher=async(_id,request)=>{sends++;return {operationId:request.operationId,status:'applied'};};
  const raw={productId:p.id,code:'ASSIGN-CODE',idempotencyKey:crypto.randomUUID()};
  await expect(redeemCode(db,'b',raw,Date.now(),dispatch)).rejects.toThrow('REDEMPTION_UNAVAILABLE');expect(sends).toBe(0);
  const result=await redeemCode(db,'a',raw,Date.now(),dispatch);
  expect(result.reward.kind).toBe('external');expect(sends).toBe(1);
  expect(await redeemCode(db,'a',raw,Date.now(),dispatch)).toEqual(result);expect(sends).toBe(1);
 }finally{sqlite.close();}
});

it('API 直接指派檢查商品與發碼權限、記錄權杖及隔離冪等鍵',async()=>{
 const {createApiToken,authenticateApiToken,revokeApiToken}=await import('../src/lib/server/api-tokens');
 const {executeApiOperation}=await import('../src/lib/server/api-operations');
 const {db,sqlite,p,input}=await setup('external',true);try{
  const token=await createApiToken(db,{name:'Assignments',scopes:['codes:issue','codes:read'],productIds:[p.id],mcpWriteEnabled:true});
  const principal=await authenticateApiToken(db,`Bearer ${token.token}`);
  const raw={...input(),action:'codes.assign'};
  await expect(executeApiOperation(db,{...principal,scopes:['codes:read']},raw)).rejects.toThrow('API_SCOPE_DENIED');
  await expect(executeApiOperation(db,{...principal,productIds:[crypto.randomUUID()]},raw)).rejects.toThrow('API_SCOPE_DENIED');
  const {handleMcpRequest}=await import('../src/lib/server/mcp');
  const {action,...args}=raw;void action;
  const response=await handleMcpRequest(new Request('https://keydrop.example/mcp',{method:'POST',headers:{Authorization:`Bearer ${token.token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'assign_code',arguments:args}})}),{db,appUrl:'https://keydrop.example',identitySecret:identity});
  const body=await response.json() as {result:{structuredContent:unknown;isError?:boolean}};
  expect(body.result.isError).not.toBe(true);
  const first=await executeApiOperation(db,principal,raw);expect(first).toEqual(body.result.structuredContent);expect(await executeApiOperation(db,principal,raw)).toEqual(first);
  expect(sqlite.prepare('SELECT api_token_id FROM code_assignments').get()?.api_token_id).toBe(token.id);
  const second=await createApiToken(db,{name:'Second',scopes:['codes:issue'],productIds:[p.id]});
  const other=await authenticateApiToken(db,`Bearer ${second.token}`);
  await executeApiOperation(db,other,{...raw,email:'b@example.test'});
  expect(sqlite.prepare('SELECT count(*) n FROM code_assignments').get()?.n).toBe(2);
  const history=await executeApiOperation(db,principal,{action:'assignments.read',productId:p.id});
  expect(JSON.stringify(history)).not.toContain('ASSIGN-CODE');
  await revokeApiToken(db,token.id);
  await expect(executeApiOperation(db,principal,raw)).rejects.toThrow('API_SCOPE_DENIED');
 }finally{sqlite.close();}
});
