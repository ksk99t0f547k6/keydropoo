import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {saveRewardRule,redeemCode} from "../src/lib/server/redemptions";
import {applyCreditOperation,creditHistory} from "../src/lib/server/credits";
async function setup(repeat="add",reclaimOnRevoke=true){
 const database=testDatabase();const p=await createProduct(database.db,{name:"App",slug:"app"});
 const b=await createBatch(database.db,"ab".repeat(32),{productId:p.id,name:"Redeem",kind:"redemption",source:"manual",codes:["CODE-A","CODE-B","CODE-C"]});
 await saveRewardRule(database.db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:"credits",bucket:"tokens",amount:100,repeat,reclaimOnRevoke}});
 return {...database,p,b};
}
const request=(productId:string,code="CODE-A")=>({productId,code,idempotencyKey:crypto.randomUUID()});
it("兌換同時寫入來源額度與使用次數，冪等重試及最後一次競爭不重複發放",async()=>{
 const {db,sqlite,p}=await setup();
 try{
  const input=request(p.id);const same=await Promise.all([redeemCode(db,"a",input),redeemCode(db,"a",input)]);
  expect(same[0].id).toBe(same[1].id);
  expect(sqlite.prepare("SELECT SUM(balance) AS n FROM credit_wallets").get()?.n).toBe(100);
  expect(sqlite.prepare("SELECT SUM(use_count) AS n FROM codes").get()?.n).toBe(1);
  await expect(redeemCode(db,"a",{...input,code:"CODE-B"})).rejects.toThrow("REDEMPTION_IDEMPOTENCY_CONFLICT");
  const race=await Promise.allSettled([redeemCode(db,"b",request(p.id,"CODE-B")),redeemCode(db,"c",request(p.id,"CODE-B"))]);
  expect(race.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM redemptions").get()?.n).toBe(2);
 }finally{sqlite.close();}
});
it("拒絕重複權益時整筆兌換回滾，不消耗碼次數",async()=>{
 const {db,sqlite,p}=await setup("reject");
 try{
  await redeemCode(db,"a",request(p.id));
  await expect(redeemCode(db,"a",request(p.id,"CODE-B"))).rejects.toThrow("REWARD_ALREADY_OWNED");
  expect(sqlite.prepare("SELECT SUM(use_count) AS n FROM codes").get()?.n).toBe(1);
  expect(sqlite.prepare("SELECT COUNT(*) AS n FROM redemptions").get()?.n).toBe(1);
  expect(sqlite.prepare("SELECT SUM(balance) AS n FROM credit_wallets").get()?.n).toBe(100);
 }finally{sqlite.close();}
});
it("覆蓋保留舊消耗明細，撤銷碼回收來源未消耗額度而不動其他來源",async()=>{
 const {db,sqlite,p}=await setup("replace");
 try{
  const first=await redeemCode(db,"a",request(p.id));const wallet=sqlite.prepare("SELECT id FROM credit_wallets").get()!.id as string;
  await applyCreditOperation(db,{walletId:wallet,idempotencyKey:"spend-1",kind:"spend",amount:30});
  const second=await redeemCode(db,"a",request(p.id,"CODE-B"));
  expect((await creditHistory(db,wallet)).wallet.balance).toBe(100);
  expect(sqlite.prepare("SELECT revoked_at FROM credit_grants WHERE id=?").get(first.id)?.revoked_at).not.toBeNull();
  await applyCreditOperation(db,{walletId:wallet,idempotencyKey:"separate",kind:"grant",amount:70,relatedId:"manual-source"});
  const code=sqlite.prepare("SELECT code_id FROM redemptions WHERE id=?").get(second.id)!.code_id;
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  expect((await creditHistory(db,wallet)).wallet.balance).toBe(70);
  expect(sqlite.prepare("SELECT revoked_at FROM redemptions WHERE id=?").get(second.id)?.revoked_at).not.toBeNull();
 }finally{sqlite.close();}
});
it("外部碼、過期、撤銷與錯誤產品不能兌換；可關閉權益回收",async()=>{
 const {db,sqlite,p,b}=await setup("add",false);
 try{
  const other=await createProduct(db,{name:"Other",slug:"other"});
  await expect(redeemCode(db,"a",request(other.id))).rejects.toThrow("REDEMPTION_UNAVAILABLE");
  sqlite.prepare("UPDATE codes SET expires_at=10 WHERE batch_id=?").run(b.id);
  await expect(redeemCode(db,"a",request(p.id),20)).rejects.toThrow("REDEMPTION_UNAVAILABLE");
  sqlite.prepare("UPDATE codes SET expires_at=NULL WHERE batch_id=?").run(b.id);
  sqlite.prepare("UPDATE code_batches SET kind='external' WHERE id=?").run(b.id);
  await expect(redeemCode(db,"a",request(p.id))).rejects.toThrow("REDEMPTION_UNAVAILABLE");
  sqlite.prepare("UPDATE code_batches SET kind='redemption' WHERE id=?").run(b.id);
  const redeemed=await redeemCode(db,"a",request(p.id));const code=sqlite.prepare("SELECT code_id FROM redemptions WHERE id=?").get(redeemed.id)!.code_id;
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  expect(sqlite.prepare("SELECT balance FROM credit_wallets").get()?.balance).toBe(100);
  await expect(redeemCode(db,"b",request(p.id))).rejects.toThrow("REDEMPTION_UNAVAILABLE");
 }finally{sqlite.close();}
});
