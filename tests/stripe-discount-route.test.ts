import {it,expect,vi,beforeEach} from 'vitest';
const fixture=vi.hoisted(()=>({session:null as null|{user:{id:string}},admin:false,connection:vi.fn(),env:{STRIPE_SECRET_KEY:'sk_fixture',CODE_ENCRYPTION_KEY:'ab'.repeat(32),DB:{}},settings:{APP_URL:'https://keydrop.test'}}));
vi.mock('../src/lib/server/env',()=>({runtime:async()=>({env:fixture.env,settings:fixture.settings})}));
vi.mock('../src/lib/server/auth',()=>({createAuth:()=>({api:{getSession:async()=>fixture.session}}),isAdmin:async()=>fixture.admin}));
vi.mock('../src/lib/server/stripe-discount-service',async importOriginal=>({...await importOriginal<typeof import('../src/lib/server/stripe-discount-service')>(),connectStripeDiscounts:fixture.connection}));
import {GET,POST} from '../src/app/api/admin/stripe-discounts/route';
beforeEach(()=>{fixture.session=null;fixture.admin=false;fixture.connection.mockReset();});
it('未登入、非管理員及跨來源請求在接觸 Stripe 前拒絕',async()=>{
 expect((await GET(new Request('https://keydrop.test/api/admin/stripe-discounts'))).status).toBe(401);
 fixture.session={user:{id:'ordinary'}};
 expect((await GET(new Request('https://keydrop.test/api/admin/stripe-discounts'))).status).toBe(403);
 fixture.admin=true;
 expect((await POST(new Request('https://keydrop.test/api/admin/stripe-discounts',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{}'}))).status).toBe(403);
 expect(fixture.connection).not.toHaveBeenCalled();
});
it('管理員讀取只回傳範圍且禁止快取；偽造範圍或無效輸入先拒絕',async()=>{
 fixture.session={user:{id:'admin'}};fixture.admin=true;fixture.connection.mockResolvedValue({scope:{accountId:'acct_fixture',livemode:false}});
 const response=await GET(new Request('https://keydrop.test/api/admin/stripe-discounts'));expect(response.headers.get('Cache-Control')).toBe('no-store');expect(await response.json()).toEqual({accountId:'acct_fixture',livemode:false});
 fixture.connection.mockClear();
 const invalid=await POST(new Request('https://keydrop.test/api/admin/stripe-discounts',{method:'POST',headers:{origin:'https://keydrop.test','content-type':'application/json'},body:JSON.stringify({action:'catalog',kind:'coupon',accountId:'acct_other'})}));
 expect(invalid.status).toBe(400);expect(fixture.connection).not.toHaveBeenCalled();
});
