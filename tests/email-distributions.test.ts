import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {queueEmailDistribution} from '../src/lib/server/email-distributions';
import {reserveOrder} from '../src/lib/server/orders';
import {encryptionKey,openCode} from '../src/lib/domain/codes';
const secrets={encryptionSecret:'ab'.repeat(32),identitySecret:'test-email-distribution-secret-32-characters'};
async function setup(shared=false){
 const data=testDatabase(),{db,sqlite}=data;
 sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('admin','Admin','admin@example.test',1,0,0);
 sqlite.prepare('INSERT INTO installation(id,admin_user_id,created_at) VALUES(1,?,0)').run('admin');
 const p=await createProduct(db,{name:'Email distribution',slug:'email',priceMinor:500});
 const b=await createBatch(db,secrets.encryptionSecret,{productId:p.id,name:'Mail',kind:'external',source:'manual',codes:['MAIL-CODE'],...(shared?{distributionMode:'shared',sharedClaimLimit:2}:{})});
 const codeId=String(sqlite.prepare('SELECT id FROM codes WHERE batch_id=?').get(b.id)!.id);
 const input=(email='guest@example.test')=>({productId:p.id,codeId,email,note:'Distribution test',idempotencyKey:crypto.randomUUID()});
 return {...data,p,b,input};
}
it('未註冊收件人入列與庫存同交易，重送不重複且不儲存明文信箱',async()=>{
 const {db,sqlite,input,p,b}=await setup();try{
  const raw=input();await expect(queueEmailDistribution(db,'stranger',raw,secrets)).rejects.toThrow('ASSIGNMENT_FORBIDDEN');
  const results=await Promise.all([queueEmailDistribution(db,'admin',raw,secrets),queueEmailDistribution(db,'admin',raw,secrets)]);
  expect(results[0]).toEqual(results[1]);
  await expect(queueEmailDistribution(db,'admin',{...raw,email:'other@example.test'},secrets)).rejects.toThrow('ASSIGNMENT_CONFLICT');
  const row=sqlite.prepare('SELECT * FROM email_distributions').get()!;
  expect(JSON.stringify(row)).not.toContain('guest@example.test');
  expect(await openCode(String(row.recipient_ciphertext),await encryptionKey(secrets.encryptionSecret),`email-distribution:${row.id}`)).toBe(raw.email);
  expect(sqlite.prepare('SELECT count(*) n FROM user').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('assigned');
  await expect(reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:'buyer',idempotencyKey:crypto.randomUUID()})).rejects.toThrow('ORDER_STOCK_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('共用寄送名額包含失敗工作，重複收件人與其他通道不能超發',async()=>{
 const {db,sqlite,input,p,b}=await setup(true);try{
  await queueEmailDistribution(db,'admin',input(),secrets);
  await expect(queueEmailDistribution(db,'admin',input(),secrets)).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  await queueEmailDistribution(db,'admin',input('second@example.test'),secrets);
  sqlite.prepare("UPDATE email_distributions SET status='failed'").run();
  await expect(queueEmailDistribution(db,'admin',input('third@example.test'),secrets)).rejects.toThrow('ASSIGNMENT_UNAVAILABLE');
  await expect(reserveOrder(db,{productId:p.id,batchId:b.id,buyerKey:'buyer',idempotencyKey:crypto.randomUUID()})).rejects.toThrow('ORDER_STOCK_UNAVAILABLE');
  expect(sqlite.prepare('SELECT count(*) n FROM email_distributions').get()?.n).toBe(2);
 }finally{sqlite.close();}
});

it('寄送即時解密原收件地址與碼，成功後不重送，未配置保持待寄',async()=>{
 const {deliverEmailDistributions}=await import('../src/lib/server/email-distribution-delivery');
 const {db,sqlite,input}=await setup();try{
  await queueEmailDistribution(db,'admin',input(),secrets);
  expect(await deliverEmailDistributions(db,{})).toEqual({sent:0,cancelled:0});
  expect(sqlite.prepare('SELECT attempts FROM email_distributions').get()?.attempts).toBe(0);
  const mails:{to:string;text:string}[]=[];
  const config={appUrl:'https://keydrop.example',from:'sender@example.test',encryptionSecret:secrets.encryptionSecret,sender:{send:async(mail:{to:string;text:string})=>{mails.push(mail);return {messageId:'accepted'};}}};
  expect(await deliverEmailDistributions(db,config,Date.now()+1000)).toEqual({sent:1,cancelled:0});
  expect(mails[0]).toMatchObject({to:'guest@example.test'});expect(mails[0].text).toContain('MAIL-CODE');expect(mails[0].text).toContain('Find my emailed codes');expect(mails[0].text).toContain('https://keydrop.example/my-codes');
  await deliverEmailDistributions(db,config,Date.now()+2000);expect(mails).toHaveLength(1);
  expect(sqlite.prepare('SELECT status,message_id FROM email_distributions').get()).toEqual({status:'sent',message_id:'accepted'});
 }finally{sqlite.close();}
});

it('寄送失敗最多嘗試五次，錯誤不持久化；失效碼取消但不釋放名額',async()=>{
 const {deliverEmailDistributions}=await import('../src/lib/server/email-distribution-delivery');
 const {db,sqlite,input}=await setup(true);try{
  await queueEmailDistribution(db,'admin',input(),secrets,1000);
  let sends=0;const config={from:'sender@example.test',encryptionSecret:secrets.encryptionSecret,sender:{send:async()=>{sends++;throw new Error('private provider payload');}}};
  for(let n=0;n<6;n++)await deliverEmailDistributions(db,config,2000+n*400000);
  expect(sends).toBe(5);expect(sqlite.prepare('SELECT status,attempts FROM email_distributions').get()).toEqual({status:'failed',attempts:5});
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM email_distributions').all())).not.toContain('private provider');
  await queueEmailDistribution(db,'admin',input('second@example.test'),secrets,3000000);
  sqlite.prepare("UPDATE codes SET previous_status=status,status='revoked'").run();
  expect(await deliverEmailDistributions(db,config,3001000)).toEqual({sent:0,cancelled:1});
  expect(sqlite.prepare('SELECT count(*) n FROM code_distribution_usage').get()?.n).toBe(2);
 }finally{sqlite.close();}
});

it('租約中的工作不並行寄送，舊執行結果不能覆蓋新租約',async()=>{
 const {deliverEmailDistributions}=await import('../src/lib/server/email-distribution-delivery');
 const {db,sqlite,input}=await setup();try{
  await queueEmailDistribution(db,'admin',input(),secrets,1000);
  let release:(value:unknown)=>void=()=>{},started:()=>void=()=>{};
  const ready=new Promise<void>(resolve=>{started=resolve;});let sends=0;
  const config={from:'sender@example.test',encryptionSecret:secrets.encryptionSecret,sender:{send:async()=>{sends++;started();return new Promise(resolve=>{release=resolve;});}}};
  const pending=deliverEmailDistributions(db,config,2000);await ready;
  expect(await deliverEmailDistributions(db,config,2001)).toEqual({sent:0,cancelled:0});expect(sends).toBe(1);
  sqlite.prepare("UPDATE email_distributions SET lease_token='new-lease'").run();
  release({messageId:'late'});expect(await pending).toEqual({sent:0,cancelled:0});
  expect(sqlite.prepare('SELECT status,lease_token,message_id FROM email_distributions').get()).toEqual({status:'sending',lease_token:'new-lease',message_id:null});
  sqlite.prepare("UPDATE email_distributions SET attempts=5,lease_until=0").run();
  await deliverEmailDistributions(db,config,3000);expect(sends).toBe(1);
  expect(sqlite.prepare('SELECT status FROM email_distributions').get()?.status).toBe('failed');
 }finally{sqlite.close();}
});

it('人工重試保留原工作與累積次數，原請求重送不再次重設狀態',async()=>{
 const {deliverEmailDistributions}=await import('../src/lib/server/email-distribution-delivery');
 const {retryEmailDistribution,listEmailDistributions}=await import('../src/lib/server/email-distributions');
 const {db,sqlite,input,p}=await setup();try{
  const job=await queueEmailDistribution(db,'admin',input(),secrets,1000);
  const config={from:'sender@example.test',encryptionSecret:secrets.encryptionSecret,sender:{send:async()=>{throw new Error('failed');}}};
  for(let n=0;n<5;n++)await deliverEmailDistributions(db,config,2000+n*400000);
  const raw={productId:p.id,id:job.id,idempotencyKey:crypto.randomUUID(),note:'Reviewed recipient and delivery status'};
  await expect(retryEmailDistribution(db,'stranger',raw)).rejects.toThrow('ASSIGNMENT_FORBIDDEN');
  const receipt=await retryEmailDistribution(db,'admin',raw,3000000);
  expect(sqlite.prepare('SELECT attempts,total_attempts,retry_count,status FROM email_distributions').get()).toEqual({attempts:0,total_attempts:5,retry_count:1,status:'pending'});
  await deliverEmailDistributions(db,config,3001000);
  expect(await retryEmailDistribution(db,'admin',raw)).toEqual(receipt);
  expect(sqlite.prepare('SELECT attempts,total_attempts,retry_count FROM email_distributions').get()).toEqual({attempts:1,total_attempts:6,retry_count:1});
  await expect(retryEmailDistribution(db,'admin',{...raw,note:'Changed request note'})).rejects.toThrow('ASSIGNMENT_CONFLICT');
  await expect(retryEmailDistribution(db,'admin',{...raw,idempotencyKey:crypto.randomUUID()})).rejects.toThrow('EMAIL_RETRY_UNAVAILABLE');
  const history=await listEmailDistributions(db,secrets.encryptionSecret,{productId:p.id});
  expect(history.items[0]).toMatchObject({email:'guest@example.test',total_attempts:6,retry_count:1});
  expect(JSON.stringify(history)).not.toContain('MAIL-CODE');expect(JSON.stringify(history)).not.toContain('recipient_ciphertext');
  expect(sqlite.prepare('SELECT count(*) n FROM email_distributions').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM email_distribution_retries').get()?.n).toBe(1);
 }finally{sqlite.close();}
});

it('人工重試不允許已寄出、取消、跨商品或失效碼',async()=>{
 const {retryEmailDistribution}=await import('../src/lib/server/email-distributions');
 const {db,sqlite,input,p}=await setup();try{
  const job=await queueEmailDistribution(db,'admin',input(),secrets);
  const raw=()=>({productId:p.id,id:job.id,idempotencyKey:crypto.randomUUID(),note:'Checked failed delivery'});
  for(const status of ['pending','sending','sent','cancelled']){
   sqlite.prepare('UPDATE email_distributions SET status=?').run(status);
   await expect(retryEmailDistribution(db,'admin',raw())).rejects.toThrow('EMAIL_RETRY_UNAVAILABLE');
  }
  sqlite.prepare("UPDATE email_distributions SET status='failed'").run();
  await expect(retryEmailDistribution(db,'admin',{...raw(),productId:crypto.randomUUID()})).rejects.toThrow('EMAIL_RETRY_UNAVAILABLE');
  sqlite.prepare('UPDATE codes SET expires_at=1').run();
  await expect(retryEmailDistribution(db,'admin',raw())).rejects.toThrow('EMAIL_RETRY_UNAVAILABLE');
  expect(sqlite.prepare('SELECT count(*) n FROM email_distribution_retries').get()?.n).toBe(0);
 }finally{sqlite.close();}
});

it('收件信箱必須驗證才可綁定，其他帳號不能取走，綁定不重發郵件',async()=>{
 const {linkEmailDistributions}=await import('../src/lib/server/email-distributions');
 const {listMyCodes}=await import('../src/lib/server/my-codes');
 const {queueAutomaticCodeEmails}=await import('../src/lib/server/code-email');
 const {db,sqlite,input}=await setup();try{
  const job=await queueEmailDistribution(db,'admin',input(),secrets);
  sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('guest','Guest','guest@example.test',0,0,0);
  await expect(linkEmailDistributions(db,'guest',secrets.identitySecret)).rejects.toThrow('CLAIM_VERIFIED_EMAIL_REQUIRED');
  expect(await linkEmailDistributions(db,'admin',secrets.identitySecret)).toEqual({linked:0});
  expect((await listMyCodes(db,secrets.encryptionSecret,'guest')).total).toBe(0);
  sqlite.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').run('guest');
  expect(await linkEmailDistributions(db,'guest',secrets.identitySecret,5000)).toEqual({linked:1});
  expect(await linkEmailDistributions(db,'guest',secrets.identitySecret,6000)).toEqual({linked:0});
  expect(sqlite.prepare('SELECT id,user_id,linked_at FROM email_distributions').get()).toEqual({id:job.id,user_id:'guest',linked_at:5000});
  expect((await listMyCodes(db,secrets.encryptionSecret,'guest')).items[0]).toMatchObject({source:'email',code:'MAIL-CODE'});
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
  expect(()=>sqlite.prepare("UPDATE email_distributions SET user_id='admin'").run()).toThrow('EMAIL_OWNER_UNAVAILABLE');
 }finally{sqlite.close();}
});

it('共用啟用碼綁定信箱後才能以該持有人啟用裝置',async()=>{
 const {linkEmailDistributions}=await import('../src/lib/server/email-distributions');
 const {activateLicense,releaseOwnedDevice}=await import('../src/lib/server/licenses');
 const {db,sqlite,input,p}=await setup(true);try{
  sqlite.prepare("UPDATE code_batches SET kind='license'").run();
  sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,?,?)').run('guest','Guest','guest@example.test',1,0,0);
  await queueEmailDistribution(db,'admin',input(),secrets);
  const raw={productId:p.id,code:'MAIL-CODE',deviceId:'guest-device'};
  const activate=(userId:string)=>activateLicense(db,secrets.encryptionSecret,secrets.identitySecret,raw,Date.now(),userId);
  await expect(activate('guest')).rejects.toThrow('LICENSE_OWNER_REQUIRED');
  await linkEmailDistributions(db,'guest',secrets.identitySecret);
  await expect(activate('admin')).rejects.toThrow('LICENSE_OWNER_REQUIRED');
  const device=await activate('guest');await releaseOwnedDevice(db,device.activationId,'guest');
  expect(sqlite.prepare('SELECT released_at FROM license_devices').get()?.released_at).not.toBeNull();
 }finally{sqlite.close();}
});
