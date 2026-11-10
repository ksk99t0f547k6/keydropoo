import {it,expect,vi} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch,changeCodeStatus} from '../src/lib/server/inventory';
import {saveRewardRule,redeemCode} from '../src/lib/server/redemptions';
import {deliverExternalRevocations,retryExternalRevocation,listExternalRevocations} from '../src/lib/server/external-revocations';
import type {ExternalDispatcher} from '../src/lib/server/external-redemptions';
import type {ExternalGrant,ExternalRewardReceipt} from '../src/lib/server/external-reward-http';
async function setup(reclaimOnRevoke=true){
 const database=testDatabase(),{db}=database;const p=await createProduct(db,{name:'App',slug:'app'});
 const b=await createBatch(db,'ab'.repeat(32),{productId:p.id,name:'Codes',kind:'redemption',source:'manual',codes:['KEY']});
 await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:0,reward:{kind:'external',integrationId:'partner',payload:{plan:'pro'},reclaimOnRevoke}});
 const redemption=await redeemCode(db,'owner',{productId:p.id,code:'KEY',idempotencyKey:crypto.randomUUID()},Date.now(),async(_id,value)=>({operationId:value.operationId,status:'applied'}));
 const code=database.sqlite.prepare('SELECT id FROM codes').get()!.id;
 await changeCodeStatus(db,{productId:p.id,ids:[code],action:'revoke'});
 return {...database,p,b,redemption};
}
it('撤銷同交易入列，關閉回收不入列；重試使用不同於發放的固定 ID 與原快照',async()=>{
 const {db,sqlite,p,b,redemption}=await setup();try{
  await saveRewardRule(db,{productId:p.id,batchId:b.id,expectedVersion:1,reward:{kind:'credits',bucket:'changed',amount:99}});
  const sent:ExternalGrant[]=[];
  const send:ExternalDispatcher=async(id,value)=>{expect(id).toBe('partner');sent.push(value);if(sent.length===1)throw new Error('private error');return {operationId:value.operationId,status:'applied'};};
  const now=Date.now()+1000;
  expect(await deliverExternalRevocations(db,send,now)).toEqual({applied:0,failed:1});
  expect(sent[0]).toMatchObject({action:'revoke',originalOperationId:redemption.id,reward:{payload:{plan:'pro'}}});expect(sent[0].operationId).not.toBe(redemption.id);
  expect(await deliverExternalRevocations(db,send,now+1000)).toEqual({applied:0,failed:0});
  expect(await deliverExternalRevocations(db,send,now+400000)).toEqual({applied:1,failed:0});expect(sent[1]).toEqual(sent[0]);
  expect(sqlite.prepare('SELECT resolved_at FROM admin_notifications').get()?.resolved_at).not.toBeNull();
  await deliverExternalRevocations(db,send,now+500000);expect(sent).toHaveLength(2);
  await expect(retryExternalRevocation(db,redemption.id)).rejects.toThrow('EXTERNAL_REVOCATION_RETRY_UNAVAILABLE');
 }finally{sqlite.close();}
 const disabled=await setup(false);try{expect(disabled.sqlite.prepare('SELECT count(*) n FROM external_revocations').get()?.n).toBe(0);}finally{disabled.sqlite.close();}
});
it('五次失敗停止，管理員重試保留操作 ID 與累積嘗試次數',async()=>{
 const {db,sqlite,redemption}=await setup();try{
  const send=vi.fn<ExternalDispatcher>(async(_id,value)=>({operationId:value.operationId,status:'rejected'}));
  const now=Date.now()+1000;
  for(let n=0;n<5;n++)await deliverExternalRevocations(db,send,now+n*10000000);
  expect((await listExternalRevocations(db)).items[0]).toMatchObject({status:'failed',attempts:5,total_attempts:5});
  await deliverExternalRevocations(db,send,now+100000000);expect(send).toHaveBeenCalledTimes(5);
  const operationId=send.mock.calls[0][1].operationId;
  await retryExternalRevocation(db,redemption.id,now+100000000);
  send.mockImplementation(async(_id,value)=>({operationId:value.operationId,status:'applied'}));
  await deliverExternalRevocations(db,send,now+100000001);
  expect(send.mock.calls[5][1].operationId).toBe(operationId);
  expect((await listExternalRevocations(db)).items[0]).toMatchObject({status:'applied',attempts:1,total_attempts:6,retry_count:1});
 }finally{sqlite.close();}
});
it('租約接手後舊寄送失敗不能覆寫新成功，錯誤收據不解決通知',async()=>{
 const {db,sqlite}=await setup();try{
  let release:(value:ExternalRewardReceipt)=>void=()=>{};let signal:()=>void=()=>{};const ready=new Promise<void>(r=>{signal=r;});
  let original:ExternalGrant|undefined;
  const work=deliverExternalRevocations(db,async(_id,value)=>{original=value;signal();return new Promise(r=>{release=r;});},Date.now()+1000);await ready;
  sqlite.prepare('UPDATE external_revocations SET lease_until=0').run();
  expect(await deliverExternalRevocations(db,async(_id,value)=>({operationId:value.operationId,status:'applied'}),Date.now()+2000)).toEqual({applied:1,failed:0});
  release({operationId:original!.operationId,status:'rejected'});expect(await work).toEqual({applied:0,failed:0});
  expect((await listExternalRevocations(db)).items[0].status).toBe('applied');
 }finally{sqlite.close();}
 const other=await setup();try{
  await deliverExternalRevocations(other.db,async()=>({operationId:crypto.randomUUID(),status:'applied'}),Date.now()+1000);
  expect(other.sqlite.prepare('SELECT resolved_at FROM admin_notifications').get()?.resolved_at).toBeNull();
 }finally{other.sqlite.close();}
});
