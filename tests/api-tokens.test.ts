import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct} from "../src/lib/server/inventory";
import {createApiToken,authenticateApiToken,revokeApiToken,listApiTokens,requireApiScope} from "../src/lib/server/api-tokens";
import {authenticatedApiOperation} from "../src/lib/server/api-operations";

it("權杖只儲存指紋，遵守期限及撤銷且列表不洩漏憑證",async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:"App",slug:"app"});
  const token=await createApiToken(db,{name:"Read",scopes:["credits:read"],productIds:[p.id],expiresAt:2000},1000);
  expect(JSON.stringify(sqlite.prepare("SELECT * FROM api_tokens").all())).not.toContain(token.token);
  expect(JSON.stringify(await listApiTokens(db))).not.toContain(token.token);
  const principal=await authenticateApiToken(db,`Bearer ${token.token}`,1999);
  expect(()=>requireApiScope(principal,"credits:write",p.id)).toThrow("API_SCOPE_DENIED");
  expect(()=>requireApiScope(principal,"credits:read",crypto.randomUUID())).toThrow("API_SCOPE_DENIED");
  await expect(authenticateApiToken(db,`Bearer ${token.token}`,2000)).rejects.toThrow("INVALID_API_TOKEN");
  await revokeApiToken(db,token.id);
  await expect(authenticateApiToken(db,`Bearer ${token.token}`,1999)).rejects.toThrow("INVALID_API_TOKEN");
  await expect(authenticateApiToken(db,null)).rejects.toThrow("INVALID_API_TOKEN");
  await expect(authenticateApiToken(db,`Bearer ${token.token}junk`)).rejects.toThrow("INVALID_API_TOKEN");
 }finally{sqlite.close();}
});
it("商品範圍不能省略或空陣列，全部商品必須明確指定 null",async()=>{
 const {db,sqlite}=testDatabase();try{
  const base={name:"Read",scopes:["products:read"]};
  await expect(createApiToken(db,base)).rejects.toThrow();
  await expect(createApiToken(db,{...base,productIds:[]})).rejects.toThrow();
  await expect(createApiToken(db,{...base,productIds:[crypto.randomUUID()]})).rejects.toThrow("TOKEN_PRODUCTS_INVALID");
  await expect(createApiToken(db,{...base,productIds:null,expiresAt:1})).rejects.toThrow("TOKEN_EXPIRY_INVALID");
  const token=await createApiToken(db,{...base,productIds:null});
  const principal=await authenticateApiToken(db,`Bearer ${token.token}`);
  expect(()=>requireApiScope(principal,"products:read",crypto.randomUUID())).not.toThrow();
 }finally{sqlite.close();}
});
it("真實帳本 API 隔離商品與操作，冪等重試不重複入帳",async()=>{
 const {db,sqlite}=testDatabase();try{
  const a=await createProduct(db,{name:"A",slug:"a"}),b=await createProduct(db,{name:"B",slug:"b"});
  const token=await createApiToken(db,{name:"Writer",scopes:["credits:read","credits:write"],productIds:[a.id]});
  const header=`Bearer ${token.token}`;
  const write={action:"credits.write",productId:a.id,userId:"customer-a",bucket:"requests",operation:{kind:"grant",amount:100,relatedId:"purchase-1",idempotencyKey:"request-1"}};
  const first=await authenticatedApiOperation(db,header,write);
  expect(await authenticatedApiOperation(db,header,write)).toEqual(first);
  const read={action:"credits.read",productId:a.id,userId:"customer-a",bucket:"requests"};
  expect(await authenticatedApiOperation(db,header,read)).toMatchObject({wallet:{balance:100},operations:[{amount:100}]});
  await expect(authenticatedApiOperation(db,header,{...write,productId:b.id})).rejects.toThrow("API_SCOPE_DENIED");
  await expect(authenticatedApiOperation(db,header,{...read,productId:b.id})).rejects.toThrow("API_SCOPE_DENIED");
  const readonly=await createApiToken(db,{name:"Read",scopes:["credits:read"],productIds:[a.id]});
  await expect(authenticatedApiOperation(db,`Bearer ${readonly.token}`,write)).rejects.toThrow("API_SCOPE_DENIED");
  await expect(authenticatedApiOperation(db,header,{action:"entitlements.read",productId:a.id,userId:"customer-a",plan:"pro"})).rejects.toThrow("API_SCOPE_DENIED");
  expect(sqlite.prepare("SELECT count(*) AS n FROM credit_wallets").get()?.n).toBe(1);
  await expect(authenticatedApiOperation(db,header,{...write,operation:{...write.operation,walletId:crypto.randomUUID()}})).rejects.toThrow();
 }finally{sqlite.close();}
});
