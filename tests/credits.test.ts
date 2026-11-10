import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct} from "../src/lib/server/inventory";
import {ensureCreditWallet,applyCreditOperation,creditHistory,creditGrantStatus} from "../src/lib/server/credits";
async function setup(){const database=testDatabase();const p=await createProduct(database.db,{name:"App",slug:"app"});const w=await ensureCreditWallet(database.db,{productId:p.id,userId:"user-a",bucket:"tokens"});return {...database,p,w};}
const op=(walletId:string,kind:string,amount:number,relatedId:string|null=null,idempotencyKey=crypto.randomUUID() as string)=>({walletId,kind,amount,relatedId,idempotencyKey});
it("額度分來源發放、按來源扣除與退回；冪等重試不重複發放",async()=>{
 const {db,sqlite,w}=await setup();
 try{
  const grant=op(w.id,"grant",100,"redemption-a");const first=await applyCreditOperation(db,grant);
  expect(await applyCreditOperation(db,grant)).toEqual(first);
  await expect(applyCreditOperation(db,{...grant,amount:101})).rejects.toThrow("CREDIT_IDEMPOTENCY_CONFLICT");
  await applyCreditOperation(db,op(w.id,"grant",50,"redemption-b"));
  const spent=await applyCreditOperation(db,op(w.id,"spend",120));
  expect((await creditHistory(db,w.id)).wallet.balance).toBe(30);
  expect(sqlite.prepare("SELECT SUM(amount) AS n FROM credit_allocations WHERE operation_id=?").get(spent.id)?.n).toBe(120);
  const refund=op(w.id,"refund",80,spent.id);const refunded=await applyCreditOperation(db,refund);expect(refunded.balance_delta).toBe(80);
  expect(await applyCreditOperation(db,refund)).toEqual(refunded);
  expect((await creditHistory(db,w.id)).wallet.balance).toBe(110);
  await expect(applyCreditOperation(db,op(w.id,"refund",41,spent.id))).rejects.toThrow("INVALID_CREDIT_REFUND");
  await applyCreditOperation(db,op(w.id,"refund",40,spent.id));
  expect((await creditHistory(db,w.id)).wallet.balance).toBe(150);
  await expect(applyCreditOperation(db,op(w.id,"grant",100,"redemption-a"))).rejects.toThrow();
  expect((await creditHistory(db,w.id)).wallet.balance).toBe(150);
 }finally{sqlite.close();}
});
it("並行扣除不能透支，相同冪等鍵競爭只扣一次",async()=>{
 const {db,sqlite,w}=await setup();
 try{
  await applyCreditOperation(db,op(w.id,"grant",100,"source"));
  const spend=op(w.id,"spend",60);
  const same=await Promise.all([applyCreditOperation(db,spend),applyCreditOperation(db,spend)]);expect(same[0].id).toBe(same[1].id);
  const results=await Promise.allSettled([applyCreditOperation(db,op(w.id,"spend",30)),applyCreditOperation(db,op(w.id,"spend",30))]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await creditHistory(db,w.id)).wallet.balance).toBe(10);
  expect(sqlite.prepare("SELECT SUM(available) AS balance FROM credit_grants WHERE wallet_id=?").get(w.id)?.balance).toBe(10);
 }finally{sqlite.close();}
});
it("撤銷只回收來源未消耗額度；已撤銷來源的退回不復活可用餘額",async()=>{
 const {db,sqlite,w}=await setup();
 try{
  const grant=await applyCreditOperation(db,op(w.id,"grant",100,"source-a"));
  const spend=await applyCreditOperation(db,op(w.id,"spend",60));
  await applyCreditOperation(db,op(w.id,"grant",200,"source-b"));
  const revoke=op(w.id,"revoke",0,grant.id);const revoked=await applyCreditOperation(db,revoke);
  expect(revoked.balance_delta).toBe(-40);expect((await creditHistory(db,w.id)).wallet.balance).toBe(200);
  expect(await applyCreditOperation(db,revoke)).toEqual(revoked);
  expect((await creditGrantStatus(db,w.id)).find(g=>g.id===grant.id)?.consumed_outstanding).toBe(60);
  const refund=await applyCreditOperation(db,op(w.id,"refund",60,spend.id));expect(refund.balance_delta).toBe(0);
  expect((await creditGrantStatus(db,w.id)).find(g=>g.id===grant.id)?.withheldRefund).toBe(60);
  expect((await creditHistory(db,w.id)).wallet.balance).toBe(200);
  expect(sqlite.prepare("SELECT available FROM credit_grants WHERE id=?").get(grant.id)?.available).toBe(0);
  await expect(applyCreditOperation(db,op(w.id,"refund",1,spend.id))).rejects.toThrow("INVALID_CREDIT_REFUND");
 }finally{sqlite.close();}
});
it("不同使用者與具名稱額度隔離，不能退回其他錢包的扣除或撤銷其發放",async()=>{
 const {db,sqlite,w,p}=await setup();
 try{
  const other=await ensureCreditWallet(db,{productId:p.id,userId:"user-b",bucket:"tokens"});
  const otherBucket=await ensureCreditWallet(db,{productId:p.id,userId:"user-a",bucket:"images"});
  const grant=await applyCreditOperation(db,op(w.id,"grant",50,"source"));const spend=await applyCreditOperation(db,op(w.id,"spend",10));
  await expect(applyCreditOperation(db,op(other.id,"refund",10,spend.id))).rejects.toThrow("INVALID_CREDIT_REFUND");
  await expect(applyCreditOperation(db,op(other.id,"revoke",0,grant.id))).rejects.toThrow("INVALID_CREDIT_REVOCATION");
  expect((await creditHistory(db,other.id)).wallet.balance).toBe(0);expect((await creditHistory(db,otherBucket.id)).wallet.balance).toBe(0);
  expect((await ensureCreditWallet(db,{productId:p.id,userId:"user-a",bucket:"tokens"})).id).toBe(w.id);
 }finally{sqlite.close();}
});
it("管理入口建立具名稱錢包並回傳交易，拒絕不合法操作",async()=>{
 const {manageCredits}=await import("../src/lib/server/credits");
 const {db,sqlite,p}=await setup();
 try{
  const result=await manageCredits(db,{wallet:{productId:p.id,userId:"user-c",bucket:"tokens"},operation:{kind:"grant",amount:10,relatedId:"source",idempotencyKey:"request-1"}});
  expect(result.operation.balance_delta).toBe(10);
  await expect(manageCredits(db,{wallet:{productId:p.id,userId:"user-c",bucket:"tokens"},operation:{kind:"spend",amount:0,idempotencyKey:"request-2"}})).rejects.toThrow();
 }finally{sqlite.close();}
});
