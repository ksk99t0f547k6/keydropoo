import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {testDatabase} from './d1';
import {createProduct,createBatch} from '../src/lib/server/inventory';
const fixture=vi.hoisted(()=>({session:null as null|{user:{id:string}},admin:false,env:{DB:null as unknown as D1Database,CODE_ENCRYPTION_KEY:'ab'.repeat(32)},settings:{APP_URL:'https://keydrop.test'}}));
vi.mock('../src/lib/server/env',()=>({runtime:async()=>({env:fixture.env,settings:fixture.settings})}));
vi.mock('../src/lib/server/auth',()=>({createAuth:()=>({api:{getSession:async()=>fixture.session}}),isAdmin:async()=>fixture.admin}));
import {GET,POST} from '../src/app/api/handouts/route';
import {PATCH,DELETE} from '../src/app/api/handouts/[id]/route';
let database:ReturnType<typeof testDatabase>;
beforeEach(()=>{database=testDatabase();fixture.env.DB=database.db;fixture.session=null;fixture.admin=false;
 database.sqlite.prepare('INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,?,0,0)').run('admin','Admin','admin@example.test',1);
 database.sqlite.prepare("INSERT INTO installation(id,admin_user_id,created_at) VALUES(1,'admin',0)").run();});
afterEach(()=>database.sqlite.close());
const json=(method:string,url:string,body?:unknown,origin='https://keydrop.test')=>new Request(url,{method,headers:{origin,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});

it('發放端點拒絕匿名、普通帳號與跨站請求，且不快取',async()=>{
 const body={productId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID()};
 const denied=await POST(json('POST','https://keydrop.test/api/handouts',body));expect(denied.status).toBe(401);
 fixture.session={user:{id:'admin'}};
 expect((await POST(json('POST','https://keydrop.test/api/handouts',body))).status).toBe(403);
 fixture.admin=true;
 expect((await POST(json('POST','https://keydrop.test/api/handouts',body,'https://evil.test'))).status).toBe(403);
 expect((await POST(json('POST','https://keydrop.test/api/handouts',{...body,productId:'nope'}))).status).toBe(400);
 const empty=await POST(json('POST','https://keydrop.test/api/handouts',body));expect(empty.status).toBe(409);
});

it('取碼、補填收件人、搜尋、撤回的完整流程',async()=>{
 fixture.session={user:{id:'admin'}};fixture.admin=true;
 const product=await createProduct(database.db,{name:'App',slug:'app'});
 await createBatch(database.db,fixture.env.CODE_ENCRYPTION_KEY,{productId:product.id,name:'Promo',kind:'external',source:'manual',codes:['PROMO-1']});
 const taken=await POST(json('POST','https://keydrop.test/api/handouts',{productId:product.id,idempotencyKey:crypto.randomUUID()}));
 expect(taken.status).toBe(201);expect(taken.headers.get('Cache-Control')).toBe('no-store');
 const handout=await taken.json() as {id:string;code:string};expect(handout.code).toBe('PROMO-1');
 const params={params:Promise.resolve({id:handout.id})};
 const updated=await PATCH(json('PATCH',`https://keydrop.test/api/handouts/${handout.id}`,{recipient:'Leo',channel:'LINE'}),params);
 expect(await updated.json()).toMatchObject({recipient:'Leo',channel:'LINE'});
 const list=await GET(new Request('https://keydrop.test/api/handouts?query=leo'));
 expect((await list.json() as {items:unknown[]}).items).toHaveLength(1);
 const undone=await DELETE(json('DELETE',`https://keydrop.test/api/handouts/${handout.id}`),params);
 expect(undone.status).toBe(200);
 expect(database.sqlite.prepare('SELECT status FROM codes').get()?.status).toBe('available');
 expect((await PATCH(json('PATCH',`https://keydrop.test/api/handouts/${handout.id}`,{recipient:'x'}),params)).status).toBe(404);
});
