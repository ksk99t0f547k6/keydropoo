import {z} from "zod";
export async function membershipStatus(db:D1Database,productId:string,userId:string,plan:string,now=Date.now()){
 z.uuid().parse(productId);z.string().min(1).max(128).parse(userId);z.string().regex(/^[a-zA-Z0-9_-]+$/).max(80).parse(plan);
 const {results}=await db.prepare("SELECT id,starts_at,ends_at,revoked_at,replaced_by FROM membership_grants WHERE product_id=? AND user_id=? AND plan=? ORDER BY starts_at,id")
 .bind(productId,userId,plan).all<{id:string;starts_at:number;ends_at:number|null;revoked_at:number|null;replaced_by:string|null}>();
 const effective=results.map(g=>({...g,effectiveEnd:g.revoked_at===null?g.ends_at:g.ends_at===null?g.revoked_at:Math.min(g.ends_at,g.revoked_at)}));
 // 只延長連續覆蓋現在的期間；被撤銷來源造成的缺口不偽裝為有效會員。
 let end:number|null=now;let active=false;
 for(const grant of effective){if(grant.effectiveEnd!==null&&grant.effectiveEnd<=now)continue;if(grant.starts_at>(end??Infinity))continue;if(grant.effectiveEnd!==null&&grant.effectiveEnd<=grant.starts_at)continue;active=true;end=end===null||grant.effectiveEnd===null?null:Math.max(end,grant.effectiveEnd);}
 return {active,permanent:active&&end===null,expiresAt:active?end:null,grants:effective};
}
