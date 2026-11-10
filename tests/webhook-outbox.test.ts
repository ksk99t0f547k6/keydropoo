import {it,expect} from "vitest";
import {testDatabase} from "./d1";
import {createProduct,createBatch,changeCodeStatus} from "../src/lib/server/inventory";
import {deliverWebhookOutbox,type WebhookEnvelope} from "../src/lib/server/webhook-outbox";
async function setup(){
 const database=testDatabase(),{db,sqlite}=database;
 const p=await createProduct(db,{name:"App",slug:"app"});
 await createBatch(db,"ab".repeat(32),{productId:p.id,name:"Codes",kind:"external",source:"manual",codes:["secret-original"]});
 const code=sqlite.prepare("SELECT id FROM codes").get()!.id as string;
 sqlite.prepare("INSERT INTO webhook_endpoints(id,name,url,secret_name,events_json,products_json,created_at) VALUES(?,?,?,?,?,?,?)").run("endpoint","Integration","https://example.com/events","TEST_SECRET",JSON.stringify(["code.revoked"]),JSON.stringify([p.id]),1000);
 return {...database,p,code};
}
it("事件與業務同交易提交、訂閱篩選且 payload 不含原始碼",async()=>{
 const {db,sqlite,p,code}=await setup();try{
  sqlite.exec("BEGIN");sqlite.prepare("UPDATE codes SET status='revoked',previous_status='available' WHERE id=?").run(code);
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_deliveries").get()?.n).toBe(1);
  sqlite.exec("ROLLBACK");expect(sqlite.prepare("SELECT count(*) n FROM webhook_events").get()?.n).toBe(0);
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_events").get()?.n).toBe(1);
  expect(JSON.stringify(sqlite.prepare("SELECT * FROM webhook_events").all())).not.toContain("secret-original");
  sqlite.prepare("UPDATE webhook_endpoints SET products_json='[]'").run();
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"restore"});
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_events").get()?.n).toBe(2);
  expect(sqlite.prepare("SELECT count(*) n FROM webhook_deliveries").get()?.n).toBe(1);
 }finally{sqlite.close();}
});
it("通知失敗退避重試沿用事件 ID，成功後不重送；停用端點不送",async()=>{
 const {db,sqlite,p,code}=await setup();try{
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  const now=Date.now()+1000,events:WebhookEnvelope[]=[];
  expect(await deliverWebhookOutbox(db,async(_target,event)=>{events.push(event);return 503;},now)).toEqual({delivered:0,failed:1});
  expect(await deliverWebhookOutbox(db,async()=>{throw new Error("should not run");},now+1)).toEqual({delivered:0,failed:0});
  sqlite.prepare("UPDATE webhook_endpoints SET enabled=0").run();
  expect(await deliverWebhookOutbox(db,async()=>200,now+121000)).toEqual({delivered:0,failed:0});
  sqlite.prepare("UPDATE webhook_endpoints SET enabled=1").run();
  expect(await deliverWebhookOutbox(db,async(_target,event)=>{events.push(event);return 204;},now+121000)).toEqual({delivered:1,failed:0});
  expect(events[0]).toEqual(events[1]);
  expect(await deliverWebhookOutbox(db,async()=>200,now+240000)).toEqual({delivered:0,failed:0});
 }finally{sqlite.close();}
});
it("過期租約可接手，舊寄送者不得覆蓋新的結果",async()=>{
 const {db,sqlite,p,code}=await setup();try{
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  const now=Date.now()+1000;
  await deliverWebhookOutbox(db,async()=>{
   expect(await deliverWebhookOutbox(db,async()=>204,now+60001)).toEqual({delivered:1,failed:0});
   return 500;
  },now);
  expect(sqlite.prepare("SELECT status,last_status,attempts FROM webhook_deliveries").get()).toMatchObject({status:"delivered",last_status:204,attempts:2});
 }finally{sqlite.close();}
});
it("八次失敗後停止自動重試，不儲存外部錯誤文字",async()=>{
 const {db,sqlite,p,code}=await setup();try{
  await changeCodeStatus(db,{productId:p.id,ids:[code],action:"revoke"});
  for(let i=0;i<8;i++)await deliverWebhookOutbox(db,async()=>{throw new Error("private-secret-response");},Date.now()+i*86400000+1000);
  expect(sqlite.prepare("SELECT status,attempts,last_status FROM webhook_deliveries").get()).toMatchObject({status:"failed",attempts:8,last_status:null});
  expect(await deliverWebhookOutbox(db,async()=>200,Date.now()+10*86400000)).toEqual({delivered:0,failed:0});
 }finally{sqlite.close();}
});
