import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

// 僅供全新本機資料庫驗收；不清空、不覆寫既有資料，也不連線到正式環境。
const envFile=process.argv[2];
if(!envFile)throw new Error('請提供專案外的本機設定檔路徑。');
const env=parseEnv(readFileSync(envFile,'utf8')),origin=env.APP_URL;
const url=new URL(origin);
if(url.origin!==origin||url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('只允許本機 HTTP origin。');
if(!env.SETUP_SECRET||!env.ADMIN_EMAIL)throw new Error('本機設定缺少初始化參數。');
const admin=new Map(),guest=new Map();
async function request(path,{body,method=body?'POST':'GET',cookies,expected=200,originHeader=origin}={}){
 const response=await fetch(origin+path,{method,headers:{Origin:originHeader,'Content-Type':'application/json',...(cookies?{Cookie:[...cookies].map(([k,v])=>`${k}=${v}`).join('; ')}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});
 for(const header of response.headers.getSetCookie()){
  const pair=header.split(';')[0],index=pair.indexOf('=');
  cookies?.set(pair.slice(0,index),pair.slice(index+1));
 }
 assert.equal(response.status,expected,`${method} ${path} 回應非預期狀態；不輸出可能含密鑰的本文。`);
 return response.json();
}
const password=randomBytes(24).toString('base64url');
await request('/api/setup',{body:{secret:env.SETUP_SECRET,password,name:'Local smoke administrator'}});
console.log('通過：全新資料庫初始化。');
await request('/api/setup',{body:{secret:env.SETUP_SECRET,password,name:'Second administrator'},expected:409});
await request('/api/auth/sign-in/email',{body:{email:env.ADMIN_EMAIL,password},cookies:admin});
assert.ok(admin.size>0,'登入未建立 session cookie。');
await request('/api/products',{expected:401});
await request('/api/products',{body:{name:'Blocked',slug:'blocked'},cookies:admin,originHeader:'https://untrusted.example',expected:403});
console.log('通過：初始化不可重複、密碼登入、匿名管理權與跨站寫入限制。');
const product=await request('/api/products',{body:{name:'Clean deployment smoke',slug:'clean-smoke'},cookies:admin,expected:201});
const batchInput={productId:product.id,name:'Generated 1000',source:'generated',kind:'redemption',rules:{count:1000},idempotencyKey:randomUUID()};
const batch=await request('/api/batches',{body:batchInput,cookies:admin,expected:201});
assert.equal(batch.count,1000);
const replay=await request('/api/batches',{body:batchInput,cookies:admin,expected:201});
assert.equal(replay.id,batch.id);
const inventory=await request('/api/codes/search',{body:{productId:product.id},cookies:admin});
assert.equal(inventory.total,1000);
console.log('通過：產生 1,000 個碼、冪等重送與庫存查詢。');
const campaign=await request('/api/campaigns',{body:{productId:product.id,batchId:batch.id,name:'Free smoke',slug:'free-smoke',conditions:{type:'always'}},cookies:admin,expected:201});
await request(`/api/campaigns/${campaign.id}`,{method:'PATCH',body:{version:campaign.version,status:'active'},cookies:admin});
const claimInput={campaignId:campaign.id,idempotencyKey:randomUUID()};
await request('/api/claims',{body:claimInput,cookies:guest,expected:428});
const claim=await request('/api/claims',{body:claimInput,cookies:guest});
const sameClaim=await request('/api/claims',{body:claimInput,cookies:guest});
assert.deepEqual(sameClaim,claim);
const remaining=await request('/api/codes/search',{body:{productId:product.id,status:'available'},cookies:admin});
assert.equal(remaining.total,999);
console.log('通過：匿名免費領碼與重送，不需要 Stripe 或寄信。');
console.log('本機驗收完成；保留測試資料。測試管理員密碼未保存，請勿將此資料庫用於正式部署。');
