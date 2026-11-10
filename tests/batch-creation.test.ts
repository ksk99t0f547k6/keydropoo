import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct} from '../src/lib/server/inventory';
import {createFormBatch,createRequestedBatch} from '../src/lib/server/batch-creation';
const secret='ab'.repeat(32);
it('後台與 API 相同產碼請求共用收據，省略預設值不改變結果',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'}),idempotencyKey=crypto.randomUUID();
  const batch={productId:p.id,name:'Launch',kind:'license',rules:{count:10}};
  const form={...batch,source:'generated',idempotencyKey};
  const first=await createFormBatch(db,secret,form);
  expect(await createFormBatch(db,secret,form)).toEqual(first);
  expect(await createRequestedBatch(db,secret,{action:'batches.generate',idempotencyKey,batch:{...batch,maxUses:1,maxDevices:1,expiresAt:null}})).toEqual(first);
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(10);
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(1);
  await expect(createFormBatch(db,secret,{...form,name:'Changed'})).rejects.toThrow('BATCH_IDEMPOTENCY_CONFLICT');
 }finally{sqlite.close();}
});
it('後台拒絕缺少冪等鍵、外部平台產碼、未識別欄位及不合法規則',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  const form={productId:p.id,name:'Launch',kind:'license',source:'generated',rules:{count:10}};
  await expect(createFormBatch(db,secret,form)).rejects.toThrow();
  const base={...form,idempotencyKey:crypto.randomUUID()};
  await expect(createFormBatch(db,secret,{...base,kind:'external'})).rejects.toThrow();
  await expect(createFormBatch(db,secret,{...base,unexpected:true})).rejects.toThrow();
  await expect(createFormBatch(db,secret,{...base,rules:{count:1,alphabet:'01',length:12}})).rejects.toThrow();
  expect(sqlite.prepare('SELECT count(*) n FROM code_batches').get()?.n).toBe(0);
 }finally{sqlite.close();}
});
it('後台匯入保留前導零且重試沿用批次',async()=>{
 const {db,sqlite}=testDatabase();try{
  const p=await createProduct(db,{name:'App',slug:'app'});
  const form={productId:p.id,name:'Import',kind:'external',source:'import',codes:['000001'],idempotencyKey:crypto.randomUUID()};
  const first=await createFormBatch(db,secret,form);expect(await createFormBatch(db,secret,form)).toEqual(first);
  expect(sqlite.prepare('SELECT count(*) n FROM codes').get()?.n).toBe(1);
 }finally{sqlite.close();}
});
