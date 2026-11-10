import {expect,it} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch} from "../src/lib/server/inventory";
import {saveRewardRule,redeemCode} from "../src/lib/server/redemptions";
import {membershipStatus} from "../src/lib/server/memberships";
const day=86400000;
async function setup(){const database=testDatabase();const p=await createProduct(database.db,{name:"App",slug:"app"});const b=await createBatch(database.db,"ab".repeat(32),{productId:p.id,name:"Membership",kind:"redemption",source:"manual",codes:["A","B","C","D"]});return {...database,p,b};}
it("會員天數累加，已過期後從現在起算；來源撤銷留下正確的權益缺口",async()=>{
 const {db,sqlite,p,b}=await setup();
 try{
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:"membership",plan:"pro",days:10}});
  const a=await redeemCode(db,"user",{productId:p.id,code:"A",idempotencyKey:crypto.randomUUID()},day);
  await redeemCode(db,"user",{productId:p.id,code:"B",idempotencyKey:crypto.randomUUID()},2*day);
  expect((await membershipStatus(db,p.id,"user","pro",2*day)).expiresAt).toBe(21*day);
  sqlite.prepare("UPDATE redemptions SET revoked_at=? WHERE id=?").run(3*day,a.id);
  expect((await membershipStatus(db,p.id,"user","pro",4*day)).active).toBe(false);
  expect((await membershipStatus(db,p.id,"user","pro",11*day)).expiresAt).toBe(21*day);
  await redeemCode(db,"user",{productId:p.id,code:"C",idempotencyKey:crypto.randomUUID()},30*day);
  expect((await membershipStatus(db,p.id,"user","pro",30*day)).expiresAt).toBe(40*day);
  expect((await membershipStatus(db,p.id,"stranger","pro",30*day)).active).toBe(false);
 }finally{sqlite.close();}
});
it("永久權益、拒絕重複與覆蓋策略，替換來源保留歷史",async()=>{
 const {db,sqlite,p,b}=await setup();
 try{
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:"permanent",plan:"pro",repeat:"reject"}});
  const first=await redeemCode(db,"user",{productId:p.id,code:"A",idempotencyKey:crypto.randomUUID()},day);
  expect((await membershipStatus(db,p.id,"user","pro",1000*day)).permanent).toBe(true);
  await expect(redeemCode(db,"user",{productId:p.id,code:"B",idempotencyKey:crypto.randomUUID()},2*day)).rejects.toThrow("REWARD_ALREADY_OWNED");
  expect(sqlite.prepare("SELECT SUM(use_count) AS n FROM codes").get()?.n).toBe(1);
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:1,reward:{kind:"membership",plan:"pro",days:5,repeat:"replace"}});
  const second=await redeemCode(db,"user",{productId:p.id,code:"B",idempotencyKey:crypto.randomUUID()},3*day);
  const status=await membershipStatus(db,p.id,"user","pro",4*day);
  expect(status.permanent).toBe(false);expect(status.expiresAt).toBe(8*day);
  expect(status.grants.find(g=>g.id===first.id)?.replaced_by).toBe(second.id);
  expect((await membershipStatus(db,p.id,"user","pro",8*day)).active).toBe(false);
 }finally{sqlite.close();}
});
it("永久授權撤銷僅影響自己的來源，可配置不回收權益",async()=>{
 const {db,sqlite,p,b}=await setup();
 try{
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:"permanent",plan:"pro",reclaimOnRevoke:false}});
  const first=await redeemCode(db,"user",{productId:p.id,code:"A",idempotencyKey:crypto.randomUUID()},day);
  sqlite.prepare("UPDATE redemptions SET revoked_at=? WHERE id=?").run(2*day,first.id);
  expect((await membershipStatus(db,p.id,"user","pro",3*day)).permanent).toBe(true);
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:1,reward:{kind:"permanent",plan:"extra",reclaimOnRevoke:true}});
  const second=await redeemCode(db,"user",{productId:p.id,code:"B",idempotencyKey:crypto.randomUUID()},day);
  sqlite.prepare("UPDATE redemptions SET revoked_at=? WHERE id=?").run(2*day,second.id);
  expect((await membershipStatus(db,p.id,"user","extra",3*day)).active).toBe(false);
  expect((await membershipStatus(db,p.id,"user","pro",3*day)).permanent).toBe(true);
 }finally{sqlite.close();}
});
