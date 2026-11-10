import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus} from '../src/lib/server/inventory';
import {reserveOrder,attachCheckout,settleOrder} from '../src/lib/server/orders';
import {queueCodeEmail,deliverCodeEmails,queueAutomaticCodeEmails,getCodeEmailStatus} from '../src/lib/server/code-email';
const secret='ab'.repeat(32);
async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('owner','Owner','owner@example.test',1,0,0);
 const p=await createProduct(db,{name:'Product {code}',slug:'app',priceMinor:500});
 const b=await createBatch(db,secret,{productId:p.id,name:'Codes',kind:'external',source:'manual',codes:['secret-code']});
 const order=await reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:'buyer',userId:'owner',idempotencyKey:crypto.randomUUID()});
 await attachCheckout(db,order.id,'cs_test');await settleOrder(db,{orderId:order.id,sessionId:'cs_test',paymentIntentId:'pi_test',amountMinor:500,currency:'USD'});
 return {...database,p,codeId:order.reserved_code_id};
}
it('寄碼只接受本人且已驗證信箱，冪等入列不儲存原始碼',async()=>{
 const {db,sqlite,codeId}=await setup();try{
  const raw={codeId,idempotencyKey:crypto.randomUUID()};
  await expect(queueCodeEmail(db,'stranger',raw)).rejects.toThrow('EMAIL_CODE_UNAVAILABLE');
  sqlite.prepare('UPDATE "user" SET emailVerified=0').run();
  await expect(queueCodeEmail(db,'owner',raw)).rejects.toThrow('EMAIL_CODE_UNAVAILABLE');
  sqlite.prepare('UPDATE "user" SET emailVerified=1').run();
  const job=await queueCodeEmail(db,'owner',raw);expect(await queueCodeEmail(db,'owner',raw)).toEqual(job);
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM code_email_jobs').all())).not.toContain('secret-code');
  const sent:{to:string;text:string}[]=[];
  expect(await deliverCodeEmails(db,{appUrl:'https://keydrop.example',from:'sender@example.test',encryptionSecret:secret,sender:{send:async mail=>{sent.push(mail);return {messageId:'accepted-test'};}}},Date.now()+1000)).toEqual({sent:1,cancelled:0});
  expect(sent[0].text).toContain('https://keydrop.example/my-codes');expect(sent[0].to).toBe('owner@example.test');expect(sent[0].text).toContain('Product {code}:\n\nsecret-code');
  expect(sqlite.prepare('SELECT status,message_id FROM code_email_jobs').get()).toMatchObject({status:'sent',message_id:'accepted-test'});
  await deliverCodeEmails(db,{from:'sender@example.test',encryptionSecret:secret,sender:{send:async mail=>{sent.push(mail);}}},Date.now()+2000);expect(sent).toHaveLength(1);
 }finally{sqlite.close();}
});

it('完成付款後自動補入一次，未驗證信箱延後入列，已寄送不重建',async()=>{
 const {db,sqlite,codeId}=await setup();try{
  sqlite.prepare('UPDATE "user" SET emailVerified=0').run();
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
  sqlite.prepare('UPDATE "user" SET emailVerified=1').run();
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:1});
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
  const job=sqlite.prepare('SELECT id,code_id FROM code_email_jobs').get()!;
  expect(job.code_id).toBe(codeId);
  expect(await getCodeEmailStatus(db,'owner',String(job.id))).toMatchObject({status:'pending'});
  expect(await deliverCodeEmails(db,{from:'sender@example.test',encryptionSecret:secret,sender:{send:async()=>({messageId:'automatic'})}},Date.now()+1000)).toEqual({sent:1,cancelled:0});
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
 }finally{sqlite.close();}
});

it('領碼自動入列只寄給已驗證持有人，並在寄送前重新驗證',async()=>{
 const {createCampaign,setCampaignStatus}=await import('../src/lib/server/campaigns');
 const {claimCode}=await import('../src/lib/server/claims');
 const {db,sqlite,p}=await setup();try{
  sqlite.prepare("UPDATE orders SET access_revoked_at=1").run();
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
  const b=await createBatch(db,secret,{productId:p.id,name:'Claims',kind:'external',source:'manual',codes:['claim-code','guest-code']});
  const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:'Claims',slug:'claims',conditions:{type:'always'}});
  await setCampaignStatus(db,c.id,1,'active');
  const services={encryptionSecret:secret,identitySecret:'test-identity-secret-32-characters-long',purchasedCount:async()=>0,qualify:async()=>({allowed:false})};
  await claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{userId:'owner',emailVerified:true,email:'owner@example.test'},services);
  await claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{browserId:'guest',ipAddress:'192.0.2.1',emailVerified:false},services);
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:1});
  sqlite.prepare('UPDATE "user" SET emailVerified=0').run();
  let sends=0;
  expect(await deliverCodeEmails(db,{from:'sender@example.test',encryptionSecret:secret,sender:{send:async()=>{sends++;}}},Date.now()+1000)).toEqual({sent:0,cancelled:1});
  expect(sends).toBe(0);
  sqlite.prepare('UPDATE "user" SET emailVerified=1').run();
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
 }finally{sqlite.close();}
});
it('入列後撤銷碼會取消寄送，提供者失敗可重試',async()=>{
 const {db,sqlite,p,codeId}=await setup();try{
  await queueCodeEmail(db,'owner',{codeId,idempotencyKey:crypto.randomUUID()});
  const config={from:'sender@example.test',encryptionSecret:secret,sender:{send:async()=>{throw new Error('private provider failure');}}};
  await deliverCodeEmails(db,config,Date.now()+1000);
  expect(sqlite.prepare('SELECT status,attempts FROM code_email_jobs').get()).toMatchObject({status:'pending',attempts:1});
  await changeCodeStatus(db,{productId:p.id,ids:[codeId],action:'revoke'});
  expect(await deliverCodeEmails(db,config,Date.now()+400000)).toEqual({sent:0,cancelled:1});
 }finally{sqlite.close();}
});

it('郵件狀態只對本人可見，最新工作查詢不含碼或收件信箱',async()=>{
 const {getCodeEmailStatus,latestCodeEmailJobs}=await import('../src/lib/server/code-email');
 const {db,sqlite,codeId}=await setup();try{
  const job=await queueCodeEmail(db,'owner',{codeId,idempotencyKey:crypto.randomUUID()});
  expect(await getCodeEmailStatus(db,'owner',job.id)).toMatchObject({id:job.id,status:'pending',attempts:0});
  await expect(getCodeEmailStatus(db,'stranger',job.id)).rejects.toThrow('EMAIL_JOB_NOT_FOUND');
  const latest=await latestCodeEmailJobs(db,'owner',[codeId]);expect(latest).toHaveLength(1);
  expect(latest[0]).toMatchObject({id:job.id,code_id:codeId,status:'pending'});
  expect(JSON.stringify(latest)).not.toContain('secret-code');expect(JSON.stringify(latest)).not.toContain('owner@example.test');
  expect(await latestCodeEmailJobs(db,'stranger',[codeId])).toEqual([]);
  sqlite.prepare("UPDATE code_email_jobs SET status='failed',created_at=1 WHERE id=?").run(job.id);
  const newJob=await queueCodeEmail(db,'owner',{codeId,idempotencyKey:crypto.randomUUID()});
  expect((await latestCodeEmailJobs(db,'owner',[codeId])).map(j=>j.id)).toEqual([newJob.id]);
 }finally{sqlite.close();}
});

it('最後一次寄送中斷後等待租約到期，停止接手且不超過五次',async()=>{
 const {db,sqlite,codeId}=await setup();try{
  const job=await queueCodeEmail(db,'owner',{codeId,idempotencyKey:crypto.randomUUID()});
  const now=Date.now();
  sqlite.prepare("UPDATE code_email_jobs SET status='sending',attempts=5,lease_token='crashed',lease_until=? WHERE id=?").run(now+60000,job.id);
  let sends=0;
  const config={from:'sender@example.test',encryptionSecret:secret,sender:{send:async()=>{sends++;}}};
  await deliverCodeEmails(db,config,now);
  expect((await getCodeEmailStatus(db,'owner',job.id)).status).toBe('sending');
  await deliverCodeEmails(db,config,now+60000);
  await deliverCodeEmails(db,config,now+120000);
  expect(sends).toBe(0);
  expect(await getCodeEmailStatus(db,'owner',job.id)).toMatchObject({status:'failed',attempts:5});
 }finally{sqlite.close();}
});
