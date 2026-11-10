import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
import {activateLicense,validateLicense,type listProductDevices,type releaseProductDevice} from '../src/lib/server/licenses';
const fixture=vi.hoisted(()=>({session:null as null|{user:{id:string}},admin:false,env:{DB:null as unknown as D1Database},settings:{APP_URL:'https://keydrop.test'}}));
vi.mock('../src/lib/server/env',()=>({runtime:async()=>({env:fixture.env,settings:fixture.settings})}));
vi.mock('../src/lib/server/auth',()=>({createAuth:()=>({api:{getSession:async()=>fixture.session}}),isAdmin:async()=>fixture.admin}));
import {GET,DELETE} from '../src/app/api/admin/license-devices/route';
const secret='ab'.repeat(32),identity='test-only-device-identity-secret-32';
let database:ReturnType<typeof testDatabase>;
beforeEach(()=>{database=testDatabase();fixture.env.DB=database.db;fixture.session=null;fixture.admin=false;});
afterEach(()=>database.sqlite.close());
const read=(productId:string,extra='')=>GET(new Request(`https://keydrop.test/api/admin/license-devices?productId=${productId}${extra}`));
const release=(body:unknown,origin='https://keydrop.test')=>DELETE(new Request('https://keydrop.test/api/admin/license-devices',{method:'DELETE',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)}));

it('管理員裝置端點拒絕匿名、普通帳號與跨站請求',async()=>{
 const productId=crypto.randomUUID(),activationId=crypto.randomUUID();
 const denied=await read(productId);expect(denied.status).toBe(401);expect(denied.headers.get('Cache-Control')).toBe('no-store');
 expect((await release({productId,activationId})).status).toBe(401);
 fixture.session={user:{id:'ordinary'}};
 expect((await read(productId)).status).toBe(403);expect((await release({productId,activationId})).status).toBe(403);
 fixture.admin=true;
 expect((await release({productId,activationId},'https://other.test')).status).toBe(403);
 expect((await read(productId,'&page=0')).status).toBe(400);
 expect((await read(productId,'&codeId=not-a-uuid')).status).toBe(400);
});

it('後台查詢與解除使用真實資料庫，商品隔離、不洩漏憑證且重送不改時間',async()=>{
 const {db}=database;fixture.session={user:{id:'admin'}};fixture.admin=true;
 const product=await createProduct(db,{name:'App',slug:'app'}),other=await createProduct(db,{name:'Other',slug:'other'});
 await createBatch(db,secret,{productId:product.id,name:'License',kind:'license',source:'manual',codes:['PRIVATE-LICENSE']});
 const active=await activateLicense(db,secret,identity,{productId:product.id,code:'PRIVATE-LICENSE',deviceId:'private-device-id',label:'Laptop'});
 const response=await read(product.id);expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
 const list=await response.json() as Awaited<ReturnType<typeof listProductDevices>>;expect(list.devices).toHaveLength(1);expect(list.devices[0]).toMatchObject({id:active.activationId,label:'Laptop',released_at:null});
 for(const value of [active.activationToken,'PRIVATE-LICENSE','private-device-id','token_hash','token_ciphertext','device_hash'])expect(JSON.stringify(list)).not.toContain(value);
 expect((await listResult(await read(product.id,'&page=2'))).devices).toEqual([]);
 expect((await listResult(await read(product.id,`&codeId=${crypto.randomUUID()}`))).devices).toEqual([]);
 expect((await listResult(await read(other.id))).devices).toEqual([]);
 expect((await release({productId:other.id,activationId:active.activationId})).status).toBe(404);
 const body={productId:product.id,activationId:active.activationId};
 const first=await release(body);expect(first.status).toBe(200);const receipt=await first.json() as Awaited<ReturnType<typeof releaseProductDevice>>;
 expect(await (await release(body)).json()).toEqual(receipt);
 expect((await listResult(await read(product.id))).devices[0].released_at).toBe(receipt.releasedAt);
 expect((await validateLicense(db,identity,{productId:product.id,deviceId:'private-device-id',activationToken:active.activationToken})).valid).toBe(false);
});

async function listResult(response:Response){return await response.json() as Awaited<ReturnType<typeof listProductDevices>>;}
