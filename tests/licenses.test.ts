import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {activateLicense,validateLicense,releaseLicense,releaseOwnedDevice} from "../src/lib/server/licenses";
const encryption="ab".repeat(32),identity="test-identity-secret-at-least-32-characters";
async function setup(maxDevices=1){const database=testDatabase();const p=await createProduct(database.db,{name:"App",slug:"app"});await createBatch(database.db,encryption,{productId:p.id,name:"Licenses",kind:"license",source:"manual",codes:["KEY-A"],maxDevices});return {...database,p};}
it("同裝置啟用冪等，最後一個裝置額度競爭不超發",async()=>{
 const {db,sqlite,p}=await setup();
 try{
  const input={productId:p.id,code:"KEY-A",deviceId:"device-a"};
  const same=await Promise.all([activateLicense(db,encryption,identity,input),activateLicense(db,encryption,identity,input)]);
  expect(same[0]).toEqual(same[1]);
  expect((await validateLicense(db,identity,{productId:p.id,activationToken:same[0].activationToken,deviceId:"device-a"})).valid).toBe(true);
  await expect(activateLicense(db,encryption,identity,{...input,deviceId:"device-b"})).rejects.toThrow("LICENSE_ACTIVATION_UNAVAILABLE");
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM license_devices WHERE released_at IS NULL").get()?.n).toBe(1);
  expect(JSON.stringify(sqlite.prepare("SELECT * FROM license_devices").all())).not.toContain(same[0].activationToken);
 }finally{sqlite.close();}
});
it("查驗與解除須同產品與裝置憑證；重新啟用使舊憑證失效",async()=>{
 const {db,sqlite,p}=await setup();
 try{
  const input={productId:p.id,code:"KEY-A",deviceId:"device-a"};const active=await activateLicense(db,encryption,identity,input);
  const proof={productId:p.id,activationToken:active.activationToken,deviceId:"device-a"};
  await expect(validateLicense(db,identity,{...proof,deviceId:"other"})).rejects.toThrow("INVALID_LICENSE_PROOF");
  await expect(releaseLicense(db,identity,{...proof,productId:crypto.randomUUID()})).rejects.toThrow("INVALID_LICENSE_PROOF");
  await releaseLicense(db,identity,proof);expect((await validateLicense(db,identity,proof)).valid).toBe(false);
  const again=await activateLicense(db,encryption,identity,input);expect(again.activationToken).not.toBe(active.activationToken);
  await expect(validateLicense(db,identity,proof)).rejects.toThrow("INVALID_LICENSE_PROOF");
  expect((await validateLicense(db,identity,{...proof,activationToken:again.activationToken})).valid).toBe(true);
 }finally{sqlite.close();}
});
it("撤銷、到期與封存立即失效，非持有人不能用裝置識別解除",async()=>{
 const {db,sqlite,p}=await setup();
 try{
  const input={productId:p.id,code:"KEY-A",deviceId:"device-a"};const active=await activateLicense(db,encryption,identity,input);
  const proof={productId:p.id,activationToken:active.activationToken,deviceId:"device-a"};
  await expect(releaseOwnedDevice(db,active.activationId,"stranger")).rejects.toThrow("LICENSE_DEVICE_NOT_FOUND");
  const code=sqlite.prepare("SELECT id FROM codes").get()!.id;
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  expect((await validateLicense(db,identity,proof)).valid).toBe(false);
  await expect(activateLicense(db,encryption,identity,input)).rejects.toThrow("LICENSE_ACTIVATION_UNAVAILABLE");
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"restore"});
  expect((await validateLicense(db,identity,proof)).valid).toBe(true);
  sqlite.prepare("UPDATE codes SET expires_at=1").run();expect((await validateLicense(db,identity,proof)).valid).toBe(false);
  sqlite.prepare("UPDATE codes SET expires_at=NULL").run();sqlite.prepare("UPDATE products SET archived_at=1").run();expect((await validateLicense(db,identity,proof)).valid).toBe(false);
  await releaseOwnedDevice(db,active.activationId,"admin",true);
  expect(sqlite.prepare("SELECT released_at FROM license_devices").get()?.released_at).not.toBeNull();
 }finally{sqlite.close();}
});
it("不同裝置同時搶最後名額只有一個成功",async()=>{
 const {db,sqlite,p}=await setup();
 try{
  const results=await Promise.allSettled(["a","b"].map(deviceId=>activateLicense(db,encryption,identity,{productId:p.id,code:"KEY-A",deviceId})));
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 }finally{sqlite.close();}
});
it("持有人只能列出和解除自己領取碼的裝置",async()=>{
 const {db,sqlite,p}=await setup();
 try{
  const {createCampaign,setCampaignStatus}=await import("../src/lib/server/campaigns");
  const {claimCode}=await import("../src/lib/server/claims");const {listOwnedDevices}=await import("../src/lib/server/licenses");
  const batch=sqlite.prepare("SELECT id FROM code_batches").get()!.id;
  const campaign=await createCampaign(db,{productId:p.id,batchId:batch,name:"License",slug:"license",conditions:{type:"always"}});await setCampaignStatus(db,campaign.id,1,"active");
  await claimCode(db,{campaignId:campaign.id,idempotencyKey:crypto.randomUUID()},{userId:"owner",emailVerified:false},{encryptionSecret:encryption,identitySecret:identity,purchasedCount:async()=>0,qualify:async()=>({allowed:false})});
  const active=await activateLicense(db,encryption,identity,{productId:p.id,code:"KEY-A",deviceId:"device-a",label:"Laptop"});
  expect(await listOwnedDevices(db,"stranger")).toEqual([]);
  const mine=await listOwnedDevices(db,"owner");expect(mine).toHaveLength(1);expect(mine[0].label).toBe("Laptop");expect(mine[0]).not.toHaveProperty("token_hash");
  await releaseOwnedDevice(db,active.activationId,"owner");expect((await listOwnedDevices(db,"owner"))[0].released_at).not.toBeNull();
 }finally{sqlite.close();}
});

it("管理 API 的裝置查詢與解除隔離商品，不公開啟用秘密，重試保留解除時間",async()=>{
 const {db,sqlite,p}=await setup();try{
  const {createApiToken}=await import("../src/lib/server/api-tokens");
  const {authenticatedApiOperation}=await import("../src/lib/server/api-operations");
  const other=await createProduct(db,{name:"Other",slug:"other"});
  const token=await createApiToken(db,{name:"Devices",scopes:["licenses:manage"],productIds:[p.id]});
  const header=`Bearer ${token.token}`;
  const active=await activateLicense(db,encryption,identity,{productId:p.id,code:"KEY-A",deviceId:"private-device",label:"Laptop"});
  const list=await authenticatedApiOperation(db,header,{action:"licenses.read",productId:p.id});
  expect(list).toMatchObject({devices:[{id:active.activationId,label:"Laptop",released_at:null}],page:1,hasMore:false});
  for(const field of [active.activationToken,"token_hash","token_ciphertext","device_hash","private-device"])expect(JSON.stringify(list)).not.toContain(field);
  expect(await authenticatedApiOperation(db,header,{action:"licenses.read",productId:p.id,page:2})).toMatchObject({devices:[],hasMore:false});
  await expect(authenticatedApiOperation(db,header,{action:"licenses.read",productId:other.id})).rejects.toThrow("API_SCOPE_DENIED");
  const all=await createApiToken(db,{name:"All",scopes:["licenses:manage"],productIds:null});
  await expect(authenticatedApiOperation(db,`Bearer ${all.token}`,{action:"licenses.release",productId:other.id,activationId:active.activationId})).rejects.toThrow("LICENSE_DEVICE_NOT_FOUND");
  const readonly=await createApiToken(db,{name:"Codes",scopes:["codes:read"],productIds:[p.id]});
  const release={action:"licenses.release",productId:p.id,activationId:active.activationId};
  await expect(authenticatedApiOperation(db,`Bearer ${readonly.token}`,release)).rejects.toThrow("API_SCOPE_DENIED");
  const result=await authenticatedApiOperation(db,header,release);
  expect(result).toMatchObject({released:true,activationId:active.activationId});
  expect(await authenticatedApiOperation(db,header,release)).toEqual(result);
  expect((await validateLicense(db,identity,{productId:p.id,activationToken:active.activationToken,deviceId:"private-device"})).valid).toBe(false);
 }finally{sqlite.close();}
});
