import {z} from "zod";
import {findExternalAttempt,runExternalRedemption,type ExternalDispatcher} from "./external-redemptions";
import {fingerprint} from "../domain/codes";
const commonReward={repeat:z.enum(["add","replace","reject"]).default("add"),reclaimOnRevoke:z.boolean().default(true)};
const plan=z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const rewardSchema=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("external"),integrationId:plan,payload:z.record(z.string().min(1).max(80),z.json()).refine(value=>new TextEncoder().encode(JSON.stringify(value)).length<=8192,"EXTERNAL_PAYLOAD_TOO_LARGE"),...commonReward}).strict(),
 z.object({kind:z.literal("credits"),bucket:plan,amount:z.number().int().min(1).max(1000000000),...commonReward}).strict(),
 z.object({kind:z.literal("membership"),plan,days:z.number().int().min(1).max(36500),...commonReward}).strict(),
 z.object({kind:z.literal("permanent"),plan,...commonReward}).strict(),
]);
export const rewardRuleInput=z.object({productId:z.uuid(),batchId:z.uuid(),campaignId:z.uuid().nullable().default(null),expectedVersion:z.number().int().min(0),reward:rewardSchema}).strict();
export async function saveRewardRule(db:D1Database,raw:unknown){
 const input=rewardRuleInput.parse(raw);const reward=JSON.stringify(input.reward);
 const source=await db.prepare("SELECT b.id FROM code_batches b JOIN products p ON p.id=b.product_id WHERE b.id=? AND p.id=? AND b.kind='redemption' AND p.archived_at IS NULL AND (? IS NULL OR EXISTS(SELECT 1 FROM campaigns WHERE id=? AND batch_id=b.id AND product_id=p.id))")
 .bind(input.batchId,input.productId,input.campaignId,input.campaignId).first();
 if(!source)throw new Error("REWARD_SOURCE_UNAVAILABLE");
 if(input.expectedVersion===0){const id=crypto.randomUUID();await db.prepare("INSERT INTO reward_rules(id,product_id,batch_id,campaign_id,reward_json,updated_at) VALUES(?,?,?,?,?,?)").bind(id,input.productId,input.batchId,input.campaignId,reward,Date.now()).run();return {id,version:1};}
 const result=await db.prepare("UPDATE reward_rules SET reward_json=?,version=version+1,updated_at=? WHERE product_id=? AND batch_id=? AND campaign_id IS ? AND version=?").bind(reward,Date.now(),input.productId,input.batchId,input.campaignId,input.expectedVersion).run();
 if(!result.meta.changes)throw new Error("REWARD_CHANGED");return {version:input.expectedVersion+1};
}
export async function getRewardRule(db:D1Database,batchId:string,campaignId:string|null=null){
 z.uuid().parse(batchId);z.uuid().nullable().parse(campaignId);
 const row=await db.prepare("SELECT id,version,reward_json FROM reward_rules WHERE batch_id=? AND campaign_id IS ?").bind(batchId,campaignId).first<{id:string;version:number;reward_json:string}>();
 return row?{id:row.id,version:row.version,reward:rewardSchema.parse(JSON.parse(row.reward_json))}:null;
}
interface RedemptionRow {id:string;product_id:string;code_id:string;user_id:string;idempotency_key:string;rule_id:string;rule_version:number;reward_json:string;revoked_at:number|null;created_at:number;}
export async function redeemCode(db:D1Database,userId:string,raw:unknown,now=Date.now(),external?:ExternalDispatcher){
 z.string().min(1).max(128).parse(userId);
 const input=z.object({productId:z.uuid(),code:z.string().min(1).max(512),idempotencyKey:z.uuid()}).strict().parse(raw);
 const code=await db.prepare("SELECT id FROM codes WHERE product_id=? AND fingerprint=?").bind(input.productId,await fingerprint(input.code)).first<{id:string}>();
 if(!code)throw new Error("REDEMPTION_UNAVAILABLE");
 const alias=await db.prepare("SELECT a.code_id FROM external_redemption_keys k JOIN external_redemption_attempts a ON a.id=k.attempt_id WHERE k.user_id=? AND k.idempotency_key=?").bind(userId,input.idempotencyKey).first<{code_id:string}>();
 if(alias&&alias.code_id!==code.id)throw new Error("REDEMPTION_IDEMPOTENCY_CONFLICT");
 async function existing(){return db.prepare("SELECT * FROM redemptions WHERE user_id=? AND idempotency_key=?").bind(userId,input.idempotencyKey).first<RedemptionRow>();}
 function result(row:RedemptionRow){if(row.code_id!==code!.id||row.product_id!==input.productId)throw new Error("REDEMPTION_IDEMPOTENCY_CONFLICT");return {id:row.id,productId:row.product_id,reward:rewardSchema.parse(JSON.parse(row.reward_json)),revoked:row.revoked_at!==null,createdAt:row.created_at};}
 const previous=await existing();if(previous)return result(previous);
 const sourceOrder=await db.prepare(`SELECT o.id FROM orders o JOIN codes c ON c.id=o.code_id JOIN code_batches b ON b.id=c.batch_id
 WHERE b.distribution_mode='shared' AND c.id=? AND o.user_id=? AND o.access_revoked_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM code_recipients WHERE code_id=c.id AND (user_id=? OR user_id IS NULL)) ORDER BY o.created_at,o.id LIMIT 1`)
 .bind(code.id,userId,userId).first<{id:string}>();
 const savedAttempt=await findExternalAttempt(db,code.id,userId);
 const rule=savedAttempt?{id:savedAttempt.rule_id,version:savedAttempt.rule_version,reward_json:savedAttempt.reward_json}:await db.prepare(`SELECT r.id,r.version,r.reward_json FROM codes c JOIN code_batches b ON b.id=c.batch_id LEFT JOIN code_recipients cl ON cl.code_id=c.id AND (b.distribution_mode='unique' OR cl.user_id=?) JOIN reward_rules r ON r.batch_id=c.batch_id
 WHERE c.id=? AND (r.campaign_id IS NULL OR r.campaign_id=cl.campaign_id) ORDER BY r.campaign_id IS NOT NULL DESC,cl.created_at,cl.id,r.id LIMIT 1`).bind(userId,code.id).first<{id:string;version:number;reward_json:string}>();
 if(!rule)throw new Error("REWARD_NOT_CONFIGURED");const reward=rewardSchema.parse(JSON.parse(rule.reward_json));
 if(reward.kind==='external'){
  if(!external)throw new Error('EXTERNAL_REWARD_NOT_CONFIGURED');
  const id=await runExternalRedemption(db,savedAttempt??{id:crypto.randomUUID(),product_id:input.productId,code_id:code.id,user_id:userId,idempotency_key:input.idempotencyKey,rule_id:rule.id,rule_version:rule.version,reward_json:rule.reward_json,source_order_id:sourceOrder?.id??null,created_at:now},input.idempotencyKey,external,now);
  const row=await db.prepare('SELECT * FROM redemptions WHERE id=?').bind(id).first<RedemptionRow>();
  if(!row)throw new Error('EXTERNAL_REDEMPTION_FAILED');return result(row);
 }
 try{await db.prepare("INSERT INTO redemptions(id,product_id,code_id,user_id,idempotency_key,rule_id,rule_version,reward_json,created_at,source_order_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
 .bind(crypto.randomUUID(),input.productId,code.id,userId,input.idempotencyKey,rule.id,rule.version,rule.reward_json,now,sourceOrder?.id??null).run();}
 catch(error){const replay=await existing();if(replay)return result(replay);throw error;}
 return result((await existing())!);
}
