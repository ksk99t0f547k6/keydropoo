import {expect,it,vi} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus} from '../src/lib/server/inventory';
import {createCampaign,setCampaignStatus} from '../src/lib/server/campaigns';
import {claimCode,linkGuestClaim} from '../src/lib/server/claims';
import {queueGuestClaimEmail,guestClaimEmailStatus,linkEmailedGuestClaims} from '../src/lib/server/guest-claim-emails';
import {deliverGuestClaimEmails} from '../src/lib/server/guest-claim-email-delivery';
import {queueAutomaticCodeEmails} from '../src/lib/server/code-email';
import {encryptionKey,openCode} from '../src/lib/domain/codes';
import type {EmailSender} from '../src/lib/server/env';
import {listMyCodes} from '../src/lib/server/my-codes';
const secrets={encryptionSecret:'ab'.repeat(32),identitySecret:'test-identity-secret-32-characters-long'};
const services={...secrets,purchasedCount:async()=>0,qualify:async()=>({allowed:true})};
async function setup(shared=false){
 const database=testDatabase(),{db}=database;
 const p=await createProduct(db,{name:'Guest mail',slug:'guest-mail'});
 const b=await createBatch(db,secrets.encryptionSecret,{productId:p.id,name:'Mail',kind:'external',source:'manual',codes:['GUEST-A','GUEST-B'],...(shared?{distributionMode:'shared',sharedClaimLimit:30}:{})});
 const c=await createCampaign(db,{productId:p.id,batchId:b.id,name:'Guest',slug:'guest',authMode:'anonymous',perPersonLimit:30,conditions:{type:'always'}});
 await setCampaignStatus(db,c.id,1,'active');
 const actor={browserId:crypto.randomUUID()};
 const claim=async(ip='192.0.2.1',who=actor)=>claimCode(db,{campaignId:c.id,idempotencyKey:crypto.randomUUID()},{...who,ipAddress:ip,emailVerified:false},services);
 return {...database,p,b,c,actor,claim};
}
const addUser=(sqlite:ReturnType<typeof testDatabase>['sqlite'],id:string,email:string,verified=1)=>sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run(id,id,email,verified);
it('匿名寄送重播及併發只有一個加密工作，不新增庫存、事件或帳號',async()=>{
 const {db,sqlite,actor,claim}=await setup();try{
  const first=await claim();
  const queue=()=>queueGuestClaimEmail(db,first.id,actor,{email:' Guest@Example.test '},secrets);
  const results=await Promise.all([queue(),queue()]);expect(results[0]).toEqual(results[1]);
  expect(await queueGuestClaimEmail(db,first.id,actor,{email:'guest@example.test'},secrets)).toEqual(results[0]);
  await expect(queueGuestClaimEmail(db,first.id,actor,{email:'wrong@example.test'},secrets)).rejects.toThrow('EMAIL_IDEMPOTENCY_CONFLICT');
  const row=sqlite.prepare('SELECT * FROM guest_claim_emails').get()!;
  expect(JSON.stringify(row)).not.toContain('guest@example.test');expect(JSON.stringify(row)).not.toContain('192.0.2.1');
  expect(await openCode(String(row.recipient_ciphertext),await encryptionKey(secrets.encryptionSecret),`guest-claim-email:${first.id}`)).toBe('guest@example.test');
  expect(sqlite.prepare('SELECT count(*) n FROM claims').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM code_distribution_usage').get()?.n).toBe(1);
  expect(sqlite.prepare('SELECT claimed_count FROM campaigns').get()?.claimed_count).toBe(1);
  expect(sqlite.prepare('SELECT count(*) n FROM "user"').get()?.n).toBe(0);
  expect(()=>sqlite.prepare("UPDATE guest_claim_emails SET recipient_hash='changed'").run()).toThrow('GUEST_EMAIL_IMMUTABLE');
  expect(JSON.stringify(await guestClaimEmailStatus(db,first.id,actor,secrets.identitySecret))).not.toContain('recipient');
 }finally{sqlite.close();}
});
it('別的瀏覽器與已綁定他人帳號不能查詢或寄送，撤銷碼不新增工作',async()=>{
 const {db,sqlite,p,actor,claim}=await setup();try{
  const first=await claim();const other={browserId:crypto.randomUUID()};
  await expect(guestClaimEmailStatus(db,first.id,other,secrets.identitySecret)).rejects.toThrow('CLAIM_NOT_FOUND');
  await expect(queueGuestClaimEmail(db,first.id,other,{email:'guest@example.test'},secrets)).rejects.toThrow('CLAIM_NOT_FOUND');
  addUser(sqlite,'owner','owner@example.test');await linkGuestClaim(db,first.id,actor.browserId,'owner',secrets.identitySecret);
  await expect(queueGuestClaimEmail(db,first.id,actor,{email:'guest@example.test'},secrets)).rejects.toThrow('CLAIM_NOT_FOUND');
  await expect(queueGuestClaimEmail(db,first.id,{...actor,userId:'owner'},{email:'owner@example.test'},secrets)).rejects.toThrow('EMAIL_CODE_UNAVAILABLE');
  const second=await claim('192.0.2.2',other);const code=sqlite.prepare('SELECT code_id FROM claims WHERE id=?').get(second.id)!;
  await changeCodeStatus(db,{productId:p.id,ids:[code.code_id],action:'revoke'});
  await expect(queueGuestClaimEmail(db,second.id,other,{email:'guest@example.test'},secrets)).rejects.toThrow('EMAIL_CODE_UNAVAILABLE');
 }finally{sqlite.close();}
});
it('信箱與原領取 IP 各有原子小時上限，原工作重送不消耗額度',async()=>{
 const {db,sqlite,actor,claim}=await setup(true);try{
  const now=Date.now(),ids:string[]=[];
  for(let i=0;i<5;i++){const c=await claim();ids.push(c.id);await queueGuestClaimEmail(db,c.id,actor,{email:'guest@example.test'},secrets,now);}
  await queueGuestClaimEmail(db,ids[0],actor,{email:'guest@example.test'},secrets,now);
  const over=await claim();await expect(queueGuestClaimEmail(db,over.id,actor,{email:'guest@example.test'},secrets,now)).rejects.toThrow('GUEST_EMAIL_RATE_LIMITED');
  for(let i=0;i<5;i++){const c=await claim();await queueGuestClaimEmail(db,c.id,actor,{email:`next-${i}@example.test`},secrets,now);}
  const overIp=await claim();await expect(queueGuestClaimEmail(db,overIp.id,actor,{email:'new@example.test'},secrets,now)).rejects.toThrow('GUEST_EMAIL_RATE_LIMITED');
  await queueGuestClaimEmail(db,overIp.id,actor,{email:'guest@example.test'},secrets,now+3600001);
  expect(sqlite.prepare('SELECT count(*) n FROM guest_claim_emails').get()?.n).toBe(11);
 }finally{sqlite.close();}
});
it('寄送沿用原碼和信箱，五次失敗或租約中斷停止，無配置不消耗嘗試',async()=>{
 const {db,sqlite,actor,claim}=await setup();try{
  const first=await claim();await queueGuestClaimEmail(db,first.id,actor,{email:'guest@example.test'},secrets,1000);
  expect(await deliverGuestClaimEmails(db,{},2000)).toEqual({sent:0,cancelled:0});
  const send=vi.fn(async()=>{throw new Error('private mail response');});
  const config={sender:{send},from:'sender@example.test',encryptionSecret:secrets.encryptionSecret,appUrl:'https://keydrop.test'};
  for(let n=0;n<6;n++)await deliverGuestClaimEmails(db,config,2000+n*400000);
  expect(send).toHaveBeenCalledTimes(5);expect(sqlite.prepare('SELECT status,attempts FROM guest_claim_emails').get()).toEqual({status:'failed',attempts:5});
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM guest_claim_emails').all())).not.toContain('private mail response');
  sqlite.prepare("UPDATE guest_claim_emails SET status='sending',lease_token='lost',lease_until=0").run();
  await deliverGuestClaimEmails(db,config,3000000);expect(send).toHaveBeenCalledTimes(5);
  const second=await claim();await queueGuestClaimEmail(db,second.id,actor,{email:'guest@example.test'},secrets,4000000);
  const accepted=vi.fn<EmailSender['send']>(async()=>({messageId:'accepted'}));
  expect(await deliverGuestClaimEmails(db,{...config,sender:{send:accepted}},4001000)).toEqual({sent:1,cancelled:0});
  expect(accepted.mock.calls[0][0]).toMatchObject({to:'guest@example.test',text:expect.stringContaining(second.code)});
  expect(accepted.mock.calls[0][0]).toMatchObject({text:expect.stringContaining('Find my emailed codes')});
  await deliverGuestClaimEmails(db,{...config,sender:{send:accepted}},4002000);expect(accepted).toHaveBeenCalledTimes(1);
 }finally{sqlite.close();}
});
it('失效寄送取消但不釋放庫存；舊租約結果不可覆蓋接手者',async()=>{
 const {db,sqlite,p,actor,claim}=await setup();try{
  const first=await claim();await queueGuestClaimEmail(db,first.id,actor,{email:'guest@example.test'},secrets,1000);
  const code=sqlite.prepare('SELECT code_id FROM claims WHERE id=?').get(first.id)!;
  await changeCodeStatus(db,{productId:p.id,ids:[code.code_id],action:'revoke'});
  const config={from:'sender@example.test',encryptionSecret:secrets.encryptionSecret};
  const forbidden=vi.fn();expect(await deliverGuestClaimEmails(db,{...config,sender:{send:forbidden}},2000)).toEqual({sent:0,cancelled:1});expect(forbidden).not.toHaveBeenCalled();
  expect(sqlite.prepare('SELECT count(*) n FROM code_distribution_usage').get()?.n).toBe(1);
  const second=await claim();await queueGuestClaimEmail(db,second.id,actor,{email:'guest@example.test'},secrets,3000);
  let release:(v:unknown)=>void=()=>{};let started:()=>void=()=>{};const ready=new Promise<void>(resolve=>{started=resolve;});
  const slow=deliverGuestClaimEmails(db,{...config,sender:{send:async()=>{started();return new Promise(resolve=>{release=resolve;});}}},4000);await ready;
  const blocked=vi.fn();await deliverGuestClaimEmails(db,{...config,sender:{send:blocked}},5000);expect(blocked).not.toHaveBeenCalled();
  expect(await deliverGuestClaimEmails(db,{...config,sender:{send:async()=>({messageId:'new'})}},65000)).toEqual({sent:1,cancelled:0});
  release({messageId:'old'});await slow;
  expect(sqlite.prepare('SELECT message_id,attempts FROM guest_claim_emails WHERE claim_id=?').get(second.id)).toEqual({message_id:'new',attempts:2});
 }finally{sqlite.close();}
});
it('只有已驗證收件信箱可綁定或跨裝置找回，保留匿名限額、不自動再寄一次',async()=>{
 const {db,sqlite,actor,claim}=await setup();try{
  const first=await claim();await queueGuestClaimEmail(db,first.id,actor,{email:'owner@example.test'},secrets);
  addUser(sqlite,'owner','Owner@example.test',0);addUser(sqlite,'other','other@example.test');
  await expect(linkEmailedGuestClaims(db,'owner',secrets.identitySecret)).rejects.toThrow('CLAIM_VERIFIED_EMAIL_REQUIRED');
  expect(await linkEmailedGuestClaims(db,'other',secrets.identitySecret)).toEqual({linked:0});
  await expect(linkGuestClaim(db,first.id,actor.browserId,'other',secrets.identitySecret)).rejects.toThrow('CLAIM_LINK_UNAVAILABLE');
  sqlite.prepare('UPDATE "user" SET emailVerified=1 WHERE id=?').run('owner');
  const original=sqlite.prepare('SELECT subject_key,anonymous_ip_key FROM claims').get();
  expect(await linkEmailedGuestClaims(db,'owner',secrets.identitySecret)).toEqual({linked:1});
  expect(await linkEmailedGuestClaims(db,'owner',secrets.identitySecret)).toEqual({linked:0});
  expect(sqlite.prepare('SELECT subject_key,anonymous_ip_key FROM claims').get()).toEqual(original);
  expect((await listMyCodes(db,secrets.encryptionSecret,'owner')).items[0].code).toBe(first.code);
  expect(await queueAutomaticCodeEmails(db)).toEqual({queued:0});
  await expect(guestClaimEmailStatus(db,first.id,actor,secrets.identitySecret)).rejects.toThrow('CLAIM_NOT_FOUND');
  expect(await guestClaimEmailStatus(db,first.id,{...actor,userId:'owner'},secrets.identitySecret)).toMatchObject({id:first.id});
 }finally{sqlite.close();}
});
it('與直接分發共用找回上限，剩餘名額為零不綁定，分頁不漏資料',async()=>{
 const {db,sqlite,actor,claim}=await setup(true);try{
  for(let i=0;i<3;i++){const c=await claim();await queueGuestClaimEmail(db,c.id,actor,{email:'owner@example.test'},secrets);}
  addUser(sqlite,'owner','owner@example.test');
  expect(await linkEmailedGuestClaims(db,'owner',secrets.identitySecret,0)).toEqual({linked:0});
  expect(await linkEmailedGuestClaims(db,'owner',secrets.identitySecret,1)).toEqual({linked:1});
  expect(await linkEmailedGuestClaims(db,'owner',secrets.identitySecret,2)).toEqual({linked:2});
  expect(await linkEmailedGuestClaims(db,'owner',secrets.identitySecret,100)).toEqual({linked:0});
  expect(sqlite.prepare('SELECT claimed_count FROM campaigns').get()?.claimed_count).toBe(3);
 }finally{sqlite.close();}
});

it('匿名碼信用要求寄信時的語言；未知語言退回英文',async()=>{
 const {db,sqlite,actor,claim}=await setup();try{
  const ja=(await import('../messages/ja.json')).default,en=(await import('../messages/en.json')).default;
  const first=await claim();const second=await claim('192.0.2.2');
  await queueGuestClaimEmail(db,first.id,actor,{email:'ja@example.test'},{...secrets,locale:'ja'});
  await queueGuestClaimEmail(db,second.id,actor,{email:'xx@example.test'},{...secrets,locale:'xx'});
  const sent:{to:string;subject:string;text:string}[]=[];
  const sender={send:vi.fn(async(message:{to:string;subject:string;text:string})=>{sent.push(message);return {messageId:'m'};})} as unknown as EmailSender;
  await deliverGuestClaimEmails(db,{sender,from:'codes@example.test',encryptionSecret:secrets.encryptionSecret,appUrl:'https://codes.test'});
  expect(sent.find(m=>m.to==='ja@example.test')?.subject).toBe(ja.email.codeSubject);
  expect(sent.find(m=>m.to==='ja@example.test')?.text).toContain(ja.email.linkRecipient.split('{url}')[0].slice(0,10));
  expect(sent.find(m=>m.to==='xx@example.test')?.subject).toBe(en.email.codeSubject);
  expect(sqlite.prepare("SELECT locale FROM guest_claim_emails ORDER BY created_at").all().map(r=>r.locale)).toContain('ja');
 }finally{sqlite.close();}
});
