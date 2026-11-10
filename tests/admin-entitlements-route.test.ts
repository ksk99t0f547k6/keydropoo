import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {testDatabase} from './d1';
import {createProduct} from '../src/lib/server/inventory';
import {ensureCreditWallet} from '../src/lib/server/credits';
const fixture=vi.hoisted(()=>({session:null as null|{user:{id:string}},admin:false,env:{DB:null as unknown as D1Database},settings:{APP_URL:'https://keydrop.test'}}));
vi.mock('../src/lib/server/env',()=>({runtime:async()=>({env:fixture.env,settings:fixture.settings})}));
vi.mock('../src/lib/server/auth',()=>({createAuth:()=>({api:{getSession:async()=>fixture.session}}),isAdmin:async()=>fixture.admin}));
import {GET} from '../src/app/api/admin/entitlements/route';
let database:ReturnType<typeof testDatabase>;
beforeEach(()=>{database=testDatabase();fixture.env.DB=database.db;fixture.session=null;fixture.admin=false;});
afterEach(()=>database.sqlite.close());
const read=(query:Record<string,string>)=>GET(new Request(`https://keydrop.test/api/admin/entitlements?${new URLSearchParams(query)}`));
it('權益管理 API 拒絕匿名及一般帳號，所有回應禁止快取',async()=>{
 const query={productId:crypto.randomUUID()};
 const anonymous=await read(query);expect(anonymous.status).toBe(401);expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
 fixture.session={user:{id:'ordinary'}};const forbidden=await read(query);expect(forbidden.status).toBe(403);expect(forbidden.headers.get('Cache-Control')).toBe('no-store');
 fixture.admin=true;
 for(const bad of [{},{productId:'invalid'},{...query,page:'0'},{...query,view:'unknown'},{...query,view:'wallet',walletId:'invalid'}] as Record<string,string>[])expect((await read(bad)).status).toBe(400);
});
it('管理員可讀取真實資料，跨商品錢包與不存在權益回傳 404',async()=>{
 fixture.session={user:{id:'admin'}};fixture.admin=true;
 const {db}=database,p=await createProduct(db,{name:'App',slug:'app'}),other=await createProduct(db,{name:'Other',slug:'other'});
 const wallet=await ensureCreditWallet(db,{productId:p.id,userId:'api-user',bucket:'credits'});
 const response=await read({productId:p.id});expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(await response.json()).toMatchObject({view:'credits',items:[{id:wallet.id,user_id:'api-user'}]});
 const cross=await read({productId:other.id,view:'wallet',walletId:wallet.id});expect(cross.status).toBe(404);expect(cross.headers.get('Cache-Control')).toBe('no-store');
 expect((await read({productId:p.id,view:'membership',userId:'missing',plan:'pro'})).status).toBe(404);
 expect((await read({productId:crypto.randomUUID()})).status).toBe(404);
});
