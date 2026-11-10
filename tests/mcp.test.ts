import {z} from "zod";
import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct} from "../src/lib/server/inventory";
import {createApiToken,revokeApiToken} from "../src/lib/server/api-tokens";
import {handleMcpRequest} from "../src/lib/server/mcp";
const appUrl="https://keydrop.example",identitySecret="test-only-mcp-identity-at-least-32-characters";
function request(token:string,method:string,params:unknown={}){return new Request(`${appUrl}/mcp`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json, text/event-stream","MCP-Protocol-Version":"2025-11-25"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});}
async function setup(write=false){const database=testDatabase();const p=await createProduct(database.db,{name:"App",slug:"app"});const token=await createApiToken(database.db,{name:"MCP",scopes:["credits:read","credits:write","entitlements:read"],productIds:[p.id],mcpWriteEnabled:write});return {...database,p,token,context:{db:database.db,appUrl,identitySecret}};}
it("MCP 初始化與工具發現使用官方 transport，預設隱藏寫入工具",async()=>{
 const {sqlite,token,context,p}=await setup();try{
  const initialized=await handleMcpRequest(request(token.token,"initialize",{protocolVersion:"2025-11-25",capabilities:{},clientInfo:{name:"test",version:"1"}}),context);
  expect(initialized.status).toBe(200);expect(await initialized.json()).toMatchObject({result:{serverInfo:{name:"keydrop"}}});
  const list=await handleMcpRequest(request(token.token,"tools/list"),context);
  const body=z.object({result:z.object({tools:z.array(z.object({name:z.string()}))})}).parse(await list.json());expect(body.result.tools.map((t:{name:string})=>t.name)).toEqual(["read_credits","read_entitlements"]);
  const read=await handleMcpRequest(request(token.token,"tools/call",{name:"read_credits",arguments:{productId:p.id,userId:"customer",bucket:"requests"}}),context);
  expect(await read.json()).toMatchObject({result:{structuredContent:{wallet:null}}});
  const denied=await handleMcpRequest(request(token.token,"tools/call",{name:"manage_credits",arguments:{}}),context);
  const deniedBody=z.object({result:z.object({isError:z.boolean().optional()}).optional(),error:z.unknown().optional()}).parse(await denied.json());expect(deniedBody.result?.isError||deniedBody.error).toBeTruthy();
  expect(sqlite.prepare("SELECT count(*) AS n FROM credit_wallets").get()?.n).toBe(0);
 }finally{sqlite.close();}
});
it("MCP 額外授權寫入仍檢查商品，撤銷後下一次請求失效",async()=>{
 const {db,sqlite,token,context,p}=await setup(true);try{
  const args={productId:p.id,userId:"customer",bucket:"requests",operation:{kind:"grant",amount:20,idempotencyKey:"grant-1",relatedId:"source-1"}};
  const call=()=>handleMcpRequest(request(token.token,"tools/call",{name:"manage_credits",arguments:args}),context);
  const first=await (await call()).json();expect(first).toMatchObject({result:{structuredContent:{operation:{amount:20}}}});
  expect(await (await call()).json()).toEqual(first);
  const cross=await handleMcpRequest(request(token.token,"tools/call",{name:"manage_credits",arguments:{...args,productId:crypto.randomUUID()}}),context);
  expect(await cross.json()).toMatchObject({result:{isError:true,content:[{text:"API_SCOPE_DENIED"}]}});
  await revokeApiToken(db,token.id);expect((await call()).status).toBe(401);
  expect(sqlite.prepare("SELECT balance FROM credit_wallets").get()?.balance).toBe(20);
 }finally{sqlite.close();}
});
it("MCP 拒絕非同站 Origin、錯誤 Host、超大本文，且不提供 GET 串流",async()=>{
 const {sqlite,token,context}=await setup();try{
  const origin=request(token.token,"tools/list");origin.headers.set("origin","https://other.example");
  expect((await handleMcpRequest(origin,context)).status).toBe(403);
  expect((await handleMcpRequest(request(token.token,"tools/list"),{...context,appUrl:"https://other.example"})).status).toBe(403);
  const get=new Request(`${appUrl}/mcp`,{headers:{Authorization:`Bearer ${token.token}`}});
  expect((await handleMcpRequest(get,context)).status).toBe(405);
  const large=request(token.token,"tools/list",{padding:"x".repeat(1048600)});
  expect((await handleMcpRequest(large,context)).status).toBe(413);
 }finally{sqlite.close();}
});
it("官方 MCP 客戶端可協商版本、發現工具並查詢權益",async()=>{
 const {Client,StreamableHTTPClientTransport}=await import("@modelcontextprotocol/client");
 const {sqlite,token,context,p}=await setup();
 const client=new Client({name:"keydrop-integration-test",version:"1.0.0"});
 try{
  const transport=new StreamableHTTPClientTransport(new URL(`${appUrl}/mcp`),{requestInit:{headers:{Authorization:`Bearer ${token.token}`}},fetch:async(input,init)=>handleMcpRequest(new Request(input,init),context)});
  await client.connect(transport);
  const tools=await client.listTools();expect(tools.tools.map(t=>t.name)).toEqual(["read_credits","read_entitlements"]);
  const result=await client.callTool({name:"read_entitlements",arguments:{productId:p.id,userId:"customer",plan:"pro"}});
  expect(result).toMatchObject({structuredContent:{active:false,permanent:false,grants:[]}});
 }finally{await client.close();sqlite.close();}
});

it("MCP 商品建立工具要求全部商品與額外寫入授權，實際呼叫可建立商品",async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:"App",slug:"app"});
  const context={db,appUrl,identitySecret};
  for(const config of [{productIds:[p.id],mcpWriteEnabled:true},{productIds:null,mcpWriteEnabled:false},{productIds:null,mcpWriteEnabled:true}]){
   const token=await createApiToken(db,{name:"Manage",scopes:["products:read","products:write","codes:write"],...config});
   const list=await (await handleMcpRequest(request(token.token,"tools/list"),context)).json() as {result:{tools:{name:string}[]}};
   expect(list,JSON.stringify(list)).toHaveProperty("result.tools");
   const names=list.result.tools.map(t=>t.name);
   expect(names.includes("create_product")).toBe(config.productIds===null&&config.mcpWriteEnabled);
   expect(names.includes("restock_batch")).toBe(config.mcpWriteEnabled);
   if(config.productIds===null&&config.mcpWriteEnabled){
    const result=await (await handleMcpRequest(request(token.token,"tools/call",{name:"create_product",arguments:{product:{name:"MCP product",slug:"mcp-product"}}}),context)).json();
    expect(result).toMatchObject({result:{structuredContent:{name:"MCP product",slug:"mcp-product"}}});
   }
  }
  expect(sqlite.prepare("SELECT count(*) n FROM products").get()?.n).toBe(2);
 }finally{sqlite.close();}
});

it("MCP 活動工具能建立及讀取巢狀條件，修改使用版本檢查",async()=>{
 const {createBatch}=await import("../src/lib/server/inventory");
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:"App",slug:"app"});
  const b=await createBatch(db,"ab".repeat(32),{productId:p.id,name:"Codes",kind:"external",source:"manual",codes:["fixture"]});
  const token=await createApiToken(db,{name:"Campaigns",scopes:["campaigns:read","campaigns:write"],productIds:[p.id],mcpWriteEnabled:true});
  const context={db,appUrl,identitySecret};
  const list=await (await handleMcpRequest(request(token.token,"tools/list"),context)).json() as {result:{tools:{name:string}[]}};
  expect(list.result.tools.map(t=>t.name)).toEqual(expect.arrayContaining(["create_campaign","update_campaign","read_campaign"]));
  const campaign={productId:p.id,batchId:b.id,name:"Launch",slug:"launch",conditions:{type:"and",children:[{type:"authenticated"},{type:"verified_email"}]}};
  const created=await (await handleMcpRequest(request(token.token,"tools/call",{name:"create_campaign",arguments:{campaign}}),context)).json() as {result:{structuredContent:{id:string;version:number}}};
  expect(created.result.structuredContent.version).toBe(1);
  const id=created.result.structuredContent.id;
  const changed=await (await handleMcpRequest(request(token.token,"tools/call",{name:"update_campaign",arguments:{campaignId:id,expectedVersion:1,campaign:{...campaign,name:"Changed"}}}),context)).json();
  expect(changed).toMatchObject({result:{structuredContent:{version:2}}});
  const read=await (await handleMcpRequest(request(token.token,"tools/call",{name:"read_campaign",arguments:{productId:p.id,campaignId:id}}),context)).json();
  expect(read).toMatchObject({result:{structuredContent:{campaign:{name:"Changed",version:2,conditions:campaign.conditions}}}});
  const linked=await (await handleMcpRequest(request(token.token,"tools/call",{name:"create_claim_link",arguments:{productId:p.id,campaignId:id,link:{maxClaims:2}}}),context)).json() as {result:{structuredContent:{id:string;token:string}}};
  expect(linked.result.structuredContent.token).toMatch(/^[a-f0-9]{64}$/);
  const links=await (await handleMcpRequest(request(token.token,"tools/call",{name:"list_claim_links",arguments:{productId:p.id,campaignId:id}}),context)).json();
  expect(links).toMatchObject({result:{structuredContent:{links:[{id:linked.result.structuredContent.id,max_claims:2}]}}});
  expect(JSON.stringify(links)).not.toContain(linked.result.structuredContent.token);
  const saved=await (await handleMcpRequest(request(token.token,"tools/call",{name:"save_campaign_credential",arguments:{productId:p.id,campaignId:id,credential:{id:"launch",kind:"passphrase",secret:"fixture-passphrase"}}}),context)).json();
  expect(saved).toMatchObject({result:{structuredContent:{id:"launch",kind:"passphrase"}}});

 }finally{sqlite.close();}
});

it('MCP 安全產碼操作沿用冪等鍵，回應不含碼值',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  const token=await createApiToken(db,{name:'Stock',scopes:['codes:write'],productIds:[p.id],mcpWriteEnabled:true});
  const context={db,appUrl,identitySecret,services:{claims:{encryptionSecret:'ab'.repeat(32),identitySecret,purchasedCount:async()=>0,qualify:async()=>({allowed:false})}}};
  const args={idempotencyKey:crypto.randomUUID(),batch:{productId:p.id,name:'Generated',kind:'redemption',rules:{count:2}}};
  const call=()=>handleMcpRequest(request(token.token,'tools/call',{name:'generate_code_batch',arguments:args}),context);
  const first=await (await call()).json();expect(first).toMatchObject({result:{structuredContent:{count:2}}});
  expect(await (await call()).json()).toEqual(first);
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(2);
 }finally{sqlite.close();}
});

it('MCP 可設定與讀取永久權益並設定銷售批次',async()=>{
 const {createBatch}=await import('../src/lib/server/inventory');
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  const batch=await createBatch(db,'ab'.repeat(32),{productId:p.id,name:'Codes',kind:'redemption',source:'manual',codes:['fixture']});
  const token=await createApiToken(db,{name:'Settings',scopes:['products:write','rewards:read','rewards:write'],productIds:[p.id],mcpWriteEnabled:true});
  const context={db,appUrl,identitySecret};
  const call=async(name:string,args:unknown)=>(await handleMcpRequest(request(token.token,'tools/call',{name,arguments:args}),context)).json();
  expect(await call('configure_reward',{productId:p.id,batchId:batch.id,expectedVersion:0,reward:{kind:'permanent',plan:'pro'}})).toMatchObject({result:{structuredContent:{version:1}}});
  expect(await call('read_reward',{productId:p.id,batchId:batch.id})).toMatchObject({result:{structuredContent:{rule:{version:1,reward:{kind:'permanent'}}}}});
  expect(await call('configure_sales_batch',{productId:p.id,batchId:batch.id})).toMatchObject({result:{structuredContent:{ok:true}}});
 }finally{sqlite.close();}
});

it("裝置 MCP 預設只能查詢，額外授權才允許解除",async()=>{
 const {db,sqlite}=testDatabase();try{
  const {createBatch}=await import("../src/lib/server/inventory");
  const {activateLicense,validateLicense}=await import("../src/lib/server/licenses");
  const p=await createProduct(db,{name:"License",slug:"license"});
  await createBatch(db,"ab".repeat(32),{productId:p.id,name:"Keys",kind:"license",source:"manual",codes:["KEY"]});
  const active=await activateLicense(db,"ab".repeat(32),identitySecret,{productId:p.id,code:"KEY",deviceId:"fixture"});
  const context={db,appUrl,identitySecret};
  for(const enabled of [false,true]){
   const token=await createApiToken(db,{name:"License",scopes:["licenses:manage"],productIds:[p.id],mcpWriteEnabled:enabled});
   const list=await (await handleMcpRequest(request(token.token,"tools/list"),context)).json() as {result:{tools:{name:string}[]}};
   expect(list.result.tools.map(t=>t.name)).toEqual(enabled?["activate_license_device","list_license_devices","release_license_device"]:["list_license_devices"]);
   const result=await (await handleMcpRequest(request(token.token,"tools/call",{name:"release_license_device",arguments:{productId:p.id,activationId:active.activationId}}),context)).json();
   if(enabled)expect(result).toMatchObject({result:{structuredContent:{released:true}}});
   expect((await validateLicense(db,identitySecret,{productId:p.id,activationToken:active.activationToken,deviceId:"fixture"})).valid).toBe(!enabled);
  }
 }finally{sqlite.close();}
});
it('MCP Stripe 折扣只對全商品權杖顯示，寫入需額外授權，唯讀可查連線身分',async()=>{
 const Stripe=(await import('stripe')).default;
 const {stripeDiscountGateway}=await import('../src/lib/server/stripe-discounts');
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'Discounts',slug:'discounts'});
  const gateway=stripeDiscountGateway(new Stripe('sk_test_fixture',{httpClient:Stripe.createFetchHttpClient(async()=>{throw new Error('Unexpected network');})}));
  const context={db,appUrl,identitySecret,services:{discounts:async()=>({encryptionSecret:'ab'.repeat(32),connection:{scope:{accountId:'acct_fixture',livemode:false},gateway}})}};
  for(const config of [{productIds:[p.id],mcpWriteEnabled:true},{productIds:null,mcpWriteEnabled:false},{productIds:null,mcpWriteEnabled:true}]){
   const token=await createApiToken(db,{name:'Discounts',scopes:['discounts:read','discounts:write','products:read'],...config});
   const list=await (await handleMcpRequest(request(token.token,'tools/list'),context)).json() as {result:{tools:{name:string;annotations:{readOnlyHint:boolean;openWorldHint:boolean}}[]}};
   expect(list,JSON.stringify(list)).toHaveProperty("result.tools");
   const tools=list.result.tools;expect(tools.some(t=>t.name==='read_stripe_discounts')).toBe(config.productIds===null);
   expect(tools.some(t=>t.name==='manage_stripe_discounts')).toBe(config.productIds===null&&config.mcpWriteEnabled);
   if(config.productIds===null){
    expect(tools.find(t=>t.name==='read_stripe_discounts')?.annotations).toMatchObject({readOnlyHint:true,openWorldHint:true});
    const result=await (await handleMcpRequest(request(token.token,'tools/call',{name:'read_stripe_discounts',arguments:{request:{action:'connection'}}}),context)).json();
    expect(result).toMatchObject({result:{structuredContent:{accountId:'acct_fixture',livemode:false}}});
   }
  }
 }finally{sqlite.close();}
});

it('直接指派工具預設隱藏，明確開啟 MCP 寫入才可發現',async()=>{
 const {db,sqlite,p,context}=await setup();try{
  for(const enabled of [false,true]){
   const token=await createApiToken(db,{name:'Assign',scopes:['codes:issue','codes:read'],productIds:[p.id],mcpWriteEnabled:enabled});
   const body=await (await handleMcpRequest(request(token.token,'tools/list'),context)).json() as {result:{tools:{name:string}[]}};
   const names=body.result.tools.map(tool=>tool.name);
   expect(names.includes('assign_code')).toBe(enabled);expect(names).toContain('list_code_assignments');
   if(!enabled){
    const denied=await (await handleMcpRequest(request(token.token,'tools/call',{name:'assign_code',arguments:{}}),context)).json() as {error?:unknown;result?:{isError:boolean}};
    expect(denied.error||denied.result?.isError).toBeTruthy();
   }
  }
 }finally{sqlite.close();}
});
