import {z} from 'zod';
import {creditHistory,creditGrantStatus} from './credits';
import {membershipStatus} from './memberships';

const page=z.coerce.number().int().min(1).max(100000).default(1);
const listFields={query:z.string().trim().max(254).default(''),page};
export const entitlementQuery=z.discriminatedUnion('view',[
 z.object({view:z.literal('credits'),...listFields}),
 z.object({view:z.literal('memberships'),...listFields}),
 z.object({view:z.literal('wallet'),walletId:z.uuid(),page,sourcesPage:page}),
 z.object({view:z.literal('membership'),userId:z.string().min(1).max(128),plan:z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),page}),
]);

// 僅供通過管理員驗證的入口使用；任何明細都重新限制商品範圍。
export async function readProductEntitlements(db:D1Database,productId:string,raw:unknown,now=Date.now()){
 z.uuid().parse(productId);const input=entitlementQuery.parse(raw);
 const product=await db.prepare('SELECT id,name FROM products WHERE id=?').bind(productId).first<{id:string;name:string}>();
 if(!product)throw new Error('PRODUCT_NOT_FOUND');
 if(input.view==='credits'){
  const {results}=await db.prepare(`SELECT w.id,w.user_id,w.bucket,w.balance,u.email FROM credit_wallets w LEFT JOIN "user" u ON u.id=w.user_id
   WHERE w.product_id=? AND (?='' OR w.user_id=? OR u.email=? COLLATE NOCASE)
   ORDER BY w.created_at DESC,w.id LIMIT 26 OFFSET ?`).bind(productId,input.query,input.query,input.query,(input.page-1)*25)
   .all<{id:string;user_id:string;bucket:string;balance:number;email:string|null}>();
  return {view:input.view,product,query:input.query,page:input.page,items:results.slice(0,25),hasMore:results.length>25};
 }
 if(input.view==='memberships'){
  const {results}=await db.prepare(`SELECT g.user_id,g.plan,u.email,COUNT(*) AS source_count,MAX(g.created_at) AS latest
   FROM membership_grants g LEFT JOIN "user" u ON u.id=g.user_id
   WHERE g.product_id=? AND (?='' OR g.user_id=? OR u.email=? COLLATE NOCASE)
   GROUP BY g.user_id,g.plan ORDER BY latest DESC,g.user_id,g.plan LIMIT 26 OFFSET ?`)
   .bind(productId,input.query,input.query,input.query,(input.page-1)*25).all<{user_id:string;plan:string;email:string|null;source_count:number}>();
  const items=await Promise.all(results.slice(0,25).map(async row=>{
   const {active,permanent,expiresAt}=await membershipStatus(db,productId,row.user_id,row.plan,now);
   return {...row,active,permanent,expiresAt};
  }));
  return {view:input.view,product,query:input.query,page:input.page,items,hasMore:results.length>25};
 }
 if(input.view==='wallet'){
  const owner=await db.prepare('SELECT w.id,u.email FROM credit_wallets w LEFT JOIN "user" u ON u.id=w.user_id WHERE w.id=? AND w.product_id=?')
   .bind(input.walletId,productId).first<{id:string;email:string|null}>();
  if(!owner)throw new Error('CREDIT_WALLET_NOT_FOUND');
  const history=await creditHistory(db,input.walletId,input.page),sources=await creditGrantStatus(db,input.walletId,input.sourcesPage);
  // 管理頁不需要上游自訂的冪等鍵，避免將整合方誤放入的私人內容帶到瀏覽器。
  const operations=history.operations.map(({id,kind,amount,balance_delta,related_id,created_at})=>({id,kind,amount,balance_delta,related_id,created_at}));
  return {view:input.view,product,wallet:history.wallet,email:owner.email,operations,page:input.page,hasMore:history.hasMore,sources:sources.slice(0,25),sourcesPage:input.sourcesPage,sourcesHasMore:sources.length>25};
 }
 const current=await membershipStatus(db,productId,input.userId,input.plan,now);
 if(!current.grants.length)throw new Error('ENTITLEMENT_NOT_FOUND');
 const {results}=await db.prepare(`SELECT g.id,g.starts_at,g.ends_at,g.revoked_at,g.replaced_by,r.code_id,r.revoked_at AS redemption_revoked_at
  FROM membership_grants g JOIN redemptions r ON r.id=g.id
  WHERE g.product_id=? AND g.user_id=? AND g.plan=? ORDER BY g.created_at DESC,g.id LIMIT 26 OFFSET ?`)
  .bind(productId,input.userId,input.plan,(input.page-1)*25).all<{id:string;starts_at:number;ends_at:number|null;revoked_at:number|null;replaced_by:string|null;code_id:string;redemption_revoked_at:number|null}>();
 const owner=await db.prepare('SELECT email FROM "user" WHERE id=?').bind(input.userId).first<{email:string}>();
 return {view:input.view,product,userId:input.userId,email:owner?.email??null,plan:input.plan,active:current.active,permanent:current.permanent,expiresAt:current.expiresAt,sources:results.slice(0,25),page:input.page,hasMore:results.length>25};
}
export type ProductEntitlements=Awaited<ReturnType<typeof readProductEntitlements>>;
