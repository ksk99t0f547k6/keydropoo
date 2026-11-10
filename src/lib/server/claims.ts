import {z} from "zod";
import {encryptionKey,fingerprint,openCode} from "../domain/codes";
import {evaluateCondition,type ConditionContext} from "../domain/conditions";
import {getCampaign} from "./campaigns";
import {verifyCampaignCredential} from "./campaign-credentials";
export const claimInputSchema=z.object({campaignId:z.uuid(),idempotencyKey:z.uuid(),recoveryOnly:z.boolean().optional(),linkToken:z.string().regex(/^[a-f0-9]{64}$/).optional(),answers:z.record(z.string().max(120),z.union([z.string().max(2000),z.array(z.string().max(200)).max(30)])).default({}),passphrases:z.record(z.string().max(120),z.string().max(128)).default({}),invitations:z.record(z.string().max(120),z.string().max(128)).default({})}).strict();
export interface ClaimActor {
 // 由受信任伺服器取得 session／已驗證信箱或簽章 cookie，禁止接受請求 JSON 的身分欄位。
 userId?:string;email?:string;emailVerified:boolean;
 browserId?:string;ipAddress?:string;
}
export interface ClaimServices {
 encryptionSecret:string;identitySecret:string;
 purchasedCount:(userId:string,productId:string)=>Promise<number>;
 qualify:(hookId:string,actor:ClaimActor,signal:AbortSignal,campaign:{campaignId:string;productId:string})=>Promise<{allowed:boolean}>;
 now?:()=>number;
}
interface ClaimRow {id:string;code_id:string;subject_key:string;created_at:number;user_id?:string|null;}
async function privateKey(secret:string,namespace:string,value:string){
 if(secret.length<32)throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");
 const encoder=new TextEncoder();const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(`${namespace}:${value}`))),n=>n.toString(16).padStart(2,"0")).join("");
}
export async function claimCode(db:D1Database,raw:unknown,actor:ClaimActor,services:ClaimServices){
 const input=claimInputSchema.parse(raw);const key=await encryptionKey(services.encryptionSecret);
 const subject=actor.userId?`user:${actor.userId}`:actor.emailVerified&&actor.email?`email:${actor.email.toLowerCase()}`:actor.browserId?`browser:${actor.browserId}`:null;
 if(!subject)throw new Error("CLAIM_IDENTITY_REQUIRED");
 const anonymous=!actor.userId&&!(actor.emailVerified&&actor.email);
 // 未驗證信箱的帳號可以無限註冊，經公開路由（帶來源 IP）領取時和匿名身分一樣受每個網段的上限約束；
 // 已驗證信箱才免除。API／MCP 由受信任伺服器代發，沒有來源 IP，不套用網段上限。
 const networkLimited=anonymous||(!actor.emailVerified&&Boolean(actor.ipAddress));
 if(networkLimited&&!actor.ipAddress)throw new Error("CLAIM_IDENTITY_REQUIRED");
 const subjectKey=await privateKey(services.identitySecret,"claim-subject",subject);
 const ipKey=networkLimited?await privateKey(services.identitySecret,"claim-ip",actor.ipAddress!):null;
 const browserKey=actor.browserId?await privateKey(services.identitySecret,"claim-subject",`browser:${actor.browserId}`):null;
 async function existing(){return db.prepare(`SELECT id,code_id,subject_key,created_at,user_id FROM claims WHERE campaign_id=? AND idempotency_key=?
  AND (subject_key=? OR user_id=? OR (user_id IS NULL AND subject_key=?))
  AND (user_id IS NULL OR user_id=?) ORDER BY CASE WHEN user_id=? THEN 0 ELSE 1 END LIMIT 1`)
  .bind(input.campaignId,input.idempotencyKey,subjectKey,actor.userId??null,browserKey,actor.userId??null,actor.userId??null).first<ClaimRow>();}
 async function deliver(row:ClaimRow){
  const code=await db.prepare("SELECT product_id,ciphertext,status FROM codes WHERE id=?").bind(row.code_id).first<{product_id:string;ciphertext:string;status:string}>();
  if(!code)throw new Error("CLAIM_DELIVERY_UNAVAILABLE");
  return {id:row.id,code:await openCode(code.ciphertext,key,`${code.product_id}:${row.code_id}`),status:code.status,createdAt:row.created_at,canLink:!row.user_id&&row.subject_key===browserKey};
 }
 const prior=await existing();if(prior)return deliver(prior);
 if(input.recoveryOnly)throw new Error("CLAIM_NOT_FOUND");
 const campaign=await getCampaign(db,input.campaignId);if(!campaign||campaign.status!=="active")throw new Error("CLAIM_UNAVAILABLE");
 const sharedLicense=await db.prepare("SELECT id FROM code_batches WHERE id=? AND kind='license' AND distribution_mode='shared'").bind(campaign.batch_id).first();
 if(sharedLicense&&(!actor.userId||!await db.prepare('SELECT id FROM "user" WHERE id=?').bind(actor.userId).first()))throw new Error("CLAIM_LOGIN_REQUIRED");
 if(campaign.auth_mode==="account"&&!actor.userId)throw new Error("CLAIM_LOGIN_REQUIRED");
 if(campaign.auth_mode==="email"&&(!actor.emailVerified||!actor.email))throw new Error("CLAIM_VERIFIED_EMAIL_REQUIRED");
 let linkId:string|null=null;
 if(input.linkToken){
  const link=await db.prepare("SELECT id FROM campaign_links WHERE campaign_id=? AND token_hash=?").bind(campaign.id,await fingerprint(input.linkToken)).first<{id:string}>();
  if(!link)throw new Error("CLAIM_LINK_UNAVAILABLE");linkId=link.id;
 }
 if(campaign.visibility==="private"&&!linkId)throw new Error("CLAIM_LINK_UNAVAILABLE");
 // 同一請求的資格結果只查一次，發碼前重判時間條件不重送外部請求。
 const purchases=new Map<string,Promise<number>>();
 const credentials=new Map<string,Promise<boolean>>();
 const qualifications=new Map<string,Promise<{allowed:boolean}>>();
 function cached<T>(cache:Map<string,Promise<T>>,id:string,run:()=>Promise<T>){let value=cache.get(id);if(!value){value=run();cache.set(id,value);}return value;}
 const context:ConditionContext={now:(services.now??Date.now)(),identity:{userId:actor.userId,email:actor.email,emailVerified:actor.emailVerified},answers:input.answers,passphrases:input.passphrases,invitations:input.invitations,
  purchasedCount:productId=>cached(purchases,productId,()=>actor.userId?services.purchasedCount(actor.userId,productId):Promise.resolve(0)),
  verifyCredential:(id,value,kind)=>cached(credentials,JSON.stringify([id,value,kind]),()=>verifyCampaignCredential(db,campaign.id,id,value,kind)),
  qualify:(hookId,signal)=>cached(qualifications,hookId,()=>services.qualify(hookId,actor,signal,{campaignId:campaign.id,productId:campaign.product_id})),
 };
 const eligibility=await evaluateCondition(campaign.conditions,context);
 if(!eligibility.allowed)throw new Error(eligibility.reason);
 const now=(services.now??Date.now)();
 if(now!==context.now){const recheck=await evaluateCondition(campaign.conditions,{...context,now});if(!recheck.allowed)throw new Error(recheck.reason);}
 const id=crypto.randomUUID();
 try{
  const result=await db.prepare(`INSERT INTO claims(id,campaign_id,campaign_version,code_id,subject_key,anonymous_ip_key,user_id,email,idempotency_key,link_id,created_at)
 SELECT ?,?,?,k.id,?,?,?,?,?,?,? FROM codes k JOIN code_batches b ON b.id=k.batch_id WHERE k.batch_id=? AND k.product_id=?
 AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=k.id) AND ((b.distribution_mode='unique' AND NOT EXISTS(SELECT 1 FROM external_redemption_attempts a WHERE a.code_id=k.id AND a.state!='applied') AND k.status='available') OR (b.distribution_mode='shared' AND k.status IN ('available','assigned')
 AND (b.shared_claim_limit IS NULL OR (SELECT count(*) FROM code_distribution_usage u WHERE u.code_id=k.id AND (u.expires_at IS NULL OR u.expires_at>?))<b.shared_claim_limit))) AND (k.expires_at IS NULL OR k.expires_at>?) ORDER BY k.created_at,k.id LIMIT 1`)
  .bind(id,campaign.id,campaign.version,subjectKey,ipKey,actor.userId??null,actor.emailVerified?actor.email??null:null,input.idempotencyKey,linkId,now,campaign.batch_id,campaign.product_id,now,now).run();
  if(!result.meta.changes)throw new Error("CLAIM_UNAVAILABLE");
 }catch(error){
  // 另一請求可能已完成相同冪等鍵；確認持有人後回傳同一結果。
  const replay=await existing();if(replay)return deliver(replay);
  if(error instanceof Error&&error.message.includes("CLAIM_LINK_UNAVAILABLE"))throw new Error("CLAIM_LINK_UNAVAILABLE");
  if(error instanceof Error&&error.message.includes("CLAIM_UNAVAILABLE"))throw new Error("CLAIM_UNAVAILABLE");
  throw error;
 }
 return deliver((await existing())!);
}

export async function linkGuestClaim(db:D1Database,id:string,browserId:string,userId:string,identitySecret:string){
 z.uuid().parse(id);z.uuid().parse(browserId);z.string().min(1).max(128).parse(userId);
 const user=await db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').bind(userId).first<{email:string;emailVerified:number}>();
 if(!user?.emailVerified)throw new Error('CLAIM_VERIFIED_EMAIL_REQUIRED');
 const browserKey=await privateKey(identitySecret,'claim-subject',`browser:${browserId}`);
 const recipientKey=await privateKey(identitySecret,'guest-claim-email',user.email.toLowerCase());
 // 保留匿名 subject 與 IP 計數；只新增帳號持有關係，不重新分配或改動原請求鍵。
 await db.prepare(`UPDATE claims SET user_id=?,email=? WHERE id=? AND user_id IS NULL AND subject_key=?
  AND EXISTS(SELECT 1 FROM "user" WHERE id=? AND emailVerified=1 AND email=?)
  AND NOT EXISTS(SELECT 1 FROM guest_claim_emails e WHERE e.claim_id=claims.id AND e.recipient_hash!=?)`)
  .bind(userId,user.email,id,browserKey,userId,user.email,recipientKey).run();
 const owned=await db.prepare('SELECT id FROM claims WHERE id=? AND user_id=?').bind(id,userId).first();
 if(!owned){
  // claims_link_limit 觸發器會跳過超過每人上限的綁定；回傳明確原因，紀錄維持匿名可用。
  const over=await db.prepare(`SELECT 1 FROM claims c JOIN campaigns k ON k.id=c.campaign_id WHERE c.id=? AND c.user_id IS NULL AND c.subject_key=?
   AND (SELECT count(*) FROM claims x WHERE x.campaign_id=c.campaign_id AND x.user_id=?)>=k.per_person_limit`).bind(id,browserKey,userId).first();
  throw new Error(over?'CLAIM_LINK_LIMIT_REACHED':'CLAIM_LINK_UNAVAILABLE');
 }
 return {linked:true};
}
export const campaignLinkInput=z.object({expiresAt:z.number().int().nonnegative().nullable().default(null),maxClaims:z.number().int().min(1).max(1000000).nullable().default(1)}).strict();
export async function createCampaignLink(db:D1Database,campaignId:string,raw:unknown){
 z.uuid().parse(campaignId);const input=campaignLinkInput.parse(raw);
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,"0")).join("");const id=crypto.randomUUID();
 const result=await db.prepare("INSERT INTO campaign_links(id,campaign_id,token_hash,expires_at,max_claims,created_at) SELECT ?,id,?,?,?,? FROM campaigns WHERE id=?")
 .bind(id,await fingerprint(token),input.expiresAt,input.maxClaims,Date.now(),campaignId).run();
 if(!result.meta.changes)throw new Error("CAMPAIGN_NOT_FOUND");return {id,token,...input};
}
export async function revokeCampaignLink(db:D1Database,campaignId:string,id:string){
 z.uuid().parse(campaignId);z.uuid().parse(id);await db.prepare("UPDATE campaign_links SET revoked_at=? WHERE id=? AND campaign_id=? AND revoked_at IS NULL").bind(Date.now(),id,campaignId).run();
}

export async function listCampaignLinks(db:D1Database,campaignId:string){
 z.uuid().parse(campaignId);return (await db.prepare("SELECT id,expires_at,max_claims,claimed_count,revoked_at,created_at FROM campaign_links WHERE campaign_id=? ORDER BY created_at DESC,id").bind(campaignId).all<{id:string;expires_at:number|null;max_claims:number|null;claimed_count:number;revoked_at:number|null;created_at:number}>()).results;
}
