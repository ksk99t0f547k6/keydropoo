import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import {listAdminNotifications,notificationKind} from '../src/lib/server/admin-notifications';
import {deliverAdminNotificationEmails} from '../src/lib/server/admin-notification-email';

async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('admin','Admin','admin@example.test',1,0,0);
 sqlite.prepare('INSERT INTO installation(id,admin_user_id,created_at) VALUES(1,?,0)').run('admin');
 const p=await createProduct(db,{name:'Private product',slug:'notification-test'});
 const notice=(id='notice',reason='EXTERNAL_REDEMPTION_REVIEW_REQUIRED',resolved:number|null=null)=>sqlite.prepare('INSERT INTO admin_notifications(id,type,product_id,operation_id,reason,created_at,updated_at,resolved_at) VALUES(?,?,?,?,?,0,0,?)').run(id,'external_redemption_failed',p.id,`operation-${id}`,reason,resolved);
 const send=vi.fn(async(mail:{to:string;text:string})=>{void mail;return {messageId:'accepted'};});
 const config={sender:{send},from:'sender@example.test',appUrl:'https://keydrop.example'};
 return {...database,p,notice,send,config};
}

it('通知清單區分明確拒絕與結果不明，分頁與已解決篩選不洩漏碼',async()=>{
 const {db,sqlite,p,notice}=await setup();try{
  const b=await createBatch(db,'ab'.repeat(32),{productId:p.id,name:'Batch',kind:'redemption',source:'manual',codes:['PRIVATE-REJECTED','PRIVATE-UNKNOWN']});
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'external',integrationId:'partner',payload:{plan:'pro'}}});
  await expect(redeemCode(db,'customer',{productId:p.id,code:'PRIVATE-REJECTED',idempotencyKey:crypto.randomUUID()},Date.now(),async(_id,request)=>({operationId:request.operationId,status:'rejected'}))).rejects.toThrow('EXTERNAL_REDEMPTION_FAILED');
  await expect(redeemCode(db,'customer',{productId:p.id,code:'PRIVATE-UNKNOWN',idempotencyKey:crypto.randomUUID()},Date.now(),async()=>{throw new Error('PRIVATE-EXTERNAL-ERROR');})).rejects.toThrow('EXTERNAL_REDEMPTION_REVIEW_REQUIRED');
  const initial=await listAdminNotifications(db,{});
  expect(initial.items.map(n=>notificationKind(n.type,n.reason)).sort()).toEqual(['rejected','unknown']);
  expect(JSON.stringify(initial)).not.toContain('PRIVATE-');
  for(let i=0;i<24;i++)notice(`page-${i}`);
  notice('resolved','EXTERNAL_REDEMPTION_FAILED',1);
  const first=await listAdminNotifications(db,{}),second=await listAdminNotifications(db,{page:2});
  expect(first.items).toHaveLength(25);expect(first.hasMore).toBe(true);
  expect(second.items).toHaveLength(1);expect(second.hasMore).toBe(false);
  expect(new Set([...first.items,...second.items].map(n=>n.id)).size).toBe(26);
  expect((await listAdminNotifications(db,{status:'resolved'})).items.map(n=>n.id)).toEqual(['resolved']);
  await expect(listAdminNotifications(db,{page:0})).rejects.toThrow();
 }finally{sqlite.close();}
});

it('未配置、停用或管理員信箱未驗證時不入列；驗證後只寄一次且不帶私人內容',async()=>{
 const {db,sqlite,notice,send,config}=await setup();try{
  notice();
  await deliverAdminNotificationEmails(db,{});
  await deliverAdminNotificationEmails(db,{...config,enabled:false});
  sqlite.prepare('UPDATE "user" SET emailVerified=0').run();
  await deliverAdminNotificationEmails(db,config);
  expect(sqlite.prepare('SELECT count(*) n FROM admin_notification_emails').get()?.n).toBe(0);
  sqlite.prepare('UPDATE "user" SET emailVerified=1').run();
  expect(await deliverAdminNotificationEmails(db,config)).toEqual({sent:1,cancelled:0});
  await deliverAdminNotificationEmails(db,config);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toMatchObject({to:'admin@example.test'});
  expect(send.mock.calls[0][0].text).toContain('https://keydrop.example/dashboard/notifications');
  expect(send.mock.calls[0][0].text).not.toContain('Private product');
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM admin_notification_emails').all())).not.toContain('@');
  sqlite.prepare('UPDATE admin_notifications SET occurrences=2').run();
  await deliverAdminNotificationEmails(db,config);expect(send).toHaveBeenCalledTimes(2);
  expect((await listAdminNotifications(db,{})).items[0].email_status).toBe('sent');
 }finally{sqlite.close();}
});

it('明確拒絕的提醒不稱為結果不明；已解決或舊版本取消，避免寄過時通知',async()=>{
 const {db,sqlite,notice,send,config}=await setup();try{
  notice('resolved');notice('superseded');notice('rejected','EXTERNAL_REDEMPTION_FAILED');
  sqlite.prepare("INSERT INTO admin_notification_emails(notification_id,occurrence,next_attempt_at,created_at) VALUES('resolved',1,0,0),('superseded',1,0,0)").run();
  sqlite.prepare("UPDATE admin_notifications SET resolved_at=1 WHERE id='resolved'").run();
  sqlite.prepare("UPDATE admin_notifications SET occurrences=2 WHERE id='superseded'").run();
  expect(await deliverAdminNotificationEmails(db,config)).toEqual({sent:2,cancelled:2});
  expect(send.mock.calls.some(([mail])=>mail.text.includes('Delivery was rejected'))).toBe(true);
  expect(sqlite.prepare("SELECT status FROM admin_notification_emails WHERE notification_id='superseded' AND occurrence=1").get()?.status).toBe('cancelled');
 }finally{sqlite.close();}
});

it('寄信重試上限五次，提供者錯誤不保存，過期的第五次租約亦停止',async()=>{
 const {db,sqlite,notice,config}=await setup();try{
  notice();const send=vi.fn(async()=>{throw new Error('PRIVATE-PROVIDER-ERROR');});
  for(let i=0;i<7;i++)await deliverAdminNotificationEmails(db,{...config,sender:{send}},1000000+i*400000);
  expect(send).toHaveBeenCalledTimes(5);
  expect(sqlite.prepare('SELECT status,attempts FROM admin_notification_emails').get()).toMatchObject({status:'failed',attempts:5});
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM admin_notification_emails').all())).not.toContain('PRIVATE-');
  notice('crashed');
  sqlite.prepare("INSERT INTO admin_notification_emails(notification_id,occurrence,status,attempts,next_attempt_at,created_at,lease_token,lease_until) VALUES('crashed',1,'sending',5,0,0,'expired',0)").run();
  await deliverAdminNotificationEmails(db,config);
  expect(sqlite.prepare("SELECT status FROM admin_notification_emails WHERE notification_id='crashed'").get()?.status).toBe('failed');
 }finally{sqlite.close();}
});

it('入列後管理員失去驗證時取消；只讀目前管理員地址',async()=>{
 const {db,sqlite,notice,send,config}=await setup();try{
  notice();sqlite.prepare("INSERT INTO admin_notification_emails(notification_id,occurrence,next_attempt_at,created_at) VALUES('notice',1,0,0)").run();
  sqlite.prepare('UPDATE "user" SET emailVerified=0').run();
  expect(await deliverAdminNotificationEmails(db,config)).toEqual({sent:0,cancelled:1});expect(send).not.toHaveBeenCalled();
  sqlite.prepare('UPDATE "user" SET email=?,emailVerified=1').run('new-admin@example.test');
  sqlite.prepare('UPDATE admin_notifications SET occurrences=2').run();
  await deliverAdminNotificationEmails(db,config);
  expect(send.mock.calls[0][0].to).toBe('new-admin@example.test');
 }finally{sqlite.close();}
});

it('有效租約不並行寄送，過期租約的遲到結果不能覆蓋接手者',async()=>{
 const {db,sqlite,notice,config}=await setup();try{
  notice();let release:()=>void=()=>{};let started:()=>void=()=>{};
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const first=deliverAdminNotificationEmails(db,{...config,sender:{send:async()=>{started();await new Promise<void>(resolve=>{release=resolve;});}}},1000000);
  await ready;const secondSend=vi.fn(async()=>{throw new Error('later failed');});
  await deliverAdminNotificationEmails(db,{...config,sender:{send:secondSend}},1000001);expect(secondSend).not.toHaveBeenCalled();
  await deliverAdminNotificationEmails(db,{...config,sender:{send:secondSend}},1061000);expect(secondSend).toHaveBeenCalledTimes(1);
  release();expect(await first).toEqual({sent:0,cancelled:0});
  expect(sqlite.prepare('SELECT status,attempts FROM admin_notification_emails').get()).toMatchObject({status:'pending',attempts:2});
 }finally{sqlite.close();}
});
