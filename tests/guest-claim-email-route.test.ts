import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {createCampaign,setCampaignStatus} from '../src/lib/server/campaigns';
import {claimCode} from '../src/lib/server/claims';
import {browserIdentity} from '../src/lib/server/claim-identity';
import type {EmailSender} from '../src/lib/server/env';
const fixture=vi.hoisted(()=>({
 session:null as null|{user:{id:string;email:string;emailVerified:boolean}},
 env:{DB:null as unknown as D1Database,CODE_ENCRYPTION_KEY:'ab'.repeat(32),EMAIL:undefined as EmailSender|undefined},
 settings:{APP_URL:'https://keydrop.test',BETTER_AUTH_SECRET:'test-identity-secret-32-characters-long',EMAIL_FROM:'sender@example.test'},
}));
vi.mock('../src/lib/server/env',()=>({runtime:async()=>({env:fixture.env,settings:fixture.settings})}));
vi.mock('../src/lib/server/auth',()=>({createAuth:()=>({api:{getSession:async()=>fixture.session}})}));
import {GET,POST} from '../src/app/api/claims/[id]/email/route';
import {POST as claimPost} from '../src/app/api/claims/route';
let database:ReturnType<typeof testDatabase>,cookie:string,claimId:string,campaignId:string,requestKey:string;
beforeEach(async()=>{
 database=testDatabase();fixture.env.DB=database.db;fixture.session=null;fixture.env.EMAIL={send:vi.fn()};
 const p=await createProduct(database.db,{name:'Mail route',slug:'mail-route'});
 const b=await createBatch(database.db,fixture.env.CODE_ENCRYPTION_KEY,{productId:p.id,name:'Mail',kind:'external',source:'manual',codes:['EMAIL-ROUTE']});
 const c=await createCampaign(database.db,{productId:p.id,batchId:b.id,name:'Mail',slug:'mail',authMode:'anonymous',conditions:{type:'always'}});campaignId=c.id;
 await setCampaignStatus(database.db,c.id,1,'active');
 const identity=await browserIdentity(null,fixture.settings.BETTER_AUTH_SECRET,true);cookie=identity.setCookie!;
 requestKey=crypto.randomUUID();
 const claimed=await claimCode(database.db,{campaignId:c.id,idempotencyKey:requestKey},{browserId:identity.id,ipAddress:'192.0.2.1',emailVerified:false},{encryptionSecret:fixture.env.CODE_ENCRYPTION_KEY,identitySecret:fixture.settings.BETTER_AUTH_SECRET,purchasedCount:async()=>0,qualify:async()=>({allowed:true})});claimId=claimed.id;
});
afterEach(()=>database.sqlite.close());
function request(method='POST',body:unknown={email:'guest@example.test'},extra:Record<string,string>={}) {
 return new Request(`https://keydrop.test/api/claims/${claimId}/email`,{method,headers:{origin:fixture.settings.APP_URL,cookie,'content-type':'application/json','cf-connecting-ip':'192.0.2.1',...extra},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
const context=()=>({params:Promise.resolve({id:claimId})});
it('匿名寄送 API 驗證 Origin、簽章瀏覽器、領取持有權及輸入，所有回應 no-store',async()=>{
 for(const [method,headers,status] of [['POST',{origin:'https://other.test'},403],['GET',{cookie:''},403],['POST',{cookie:'__Host-keydrop-browser=forged'},403]] as const){
  const response=await (method==='GET'?GET:POST)(request(method,undefined,headers),context());expect(response.status).toBe(status);expect(response.headers.get('Cache-Control')).toBe('no-store');
 }
 const other=await browserIdentity(null,fixture.settings.BETTER_AUTH_SECRET,true);
 expect((await GET(request('GET',undefined,{cookie:other.setCookie!}),context())).status).toBe(404);
 expect((await POST(request('POST',{email:'not-mail'}),context())).status).toBe(400);
 expect((await POST(request('POST',{email:'guest@example.test',userId:'someone'}),context())).status).toBe(400);
 expect(database.sqlite.prepare('SELECT count(*) n FROM guest_claim_emails').get()?.n).toBe(0);
});
it('寄送與狀態不回傳原碼或信箱；相同重送回原工作，不同信箱衝突',async()=>{
 const empty=await GET(request('GET'),context());expect(await empty.json()).toEqual({job:null});
 const sent=await POST(request(),context());expect(sent.status).toBe(200);const receipt=await sent.json();
 expect(receipt).toEqual({job:{id:claimId,status:'pending',attempts:0}});
 expect(await(await POST(request(),context())).json()).toEqual(receipt);
 expect((await POST(request('POST',{email:'other@example.test'}),context())).status).toBe(409);
 const status=await GET(request('GET'),context());expect(await status.json()).toEqual(receipt);
 expect(status.headers.get('Cache-Control')).toBe('no-store');expect(fixture.env.EMAIL!.send).not.toHaveBeenCalled();
});
it('寄信未配置、缺少可信 IP 或過量請求不能新增寄送工作',async()=>{
 fixture.env.EMAIL=undefined;expect((await POST(request(),context())).status).toBe(503);
 fixture.env.EMAIL={send:vi.fn()};expect((await POST(request('POST',undefined,{'cf-connecting-ip':''}),context())).status).toBe(503);
 for(let i=0;i<30;i++)await POST(request('POST',{email:'invalid'}),context());
 expect((await POST(request(),context())).status).toBe(429);
 expect(database.sqlite.prepare('SELECT count(*) n FROM guest_claim_emails').get()?.n).toBe(0);
});
it('領取結果僅在寄信已配置時提供匿名 Email 入口',async()=>{
 const recover=()=>claimPost(new Request('https://keydrop.test/api/claims',{method:'POST',headers:{origin:fixture.settings.APP_URL,cookie,'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify({campaignId,idempotencyKey:requestKey,recoveryOnly:true})}));
 expect(await(await recover()).json()).toMatchObject({id:claimId,emailAvailable:true,canLink:true});
 fixture.env.EMAIL=undefined;expect(await(await recover()).json()).toMatchObject({id:claimId,emailAvailable:false,canLink:true});
});
