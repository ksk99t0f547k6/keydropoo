import {z} from "zod";
import {parseCondition,type Condition} from "../domain/conditions";

export const campaignInput=z.object({
 productId:z.uuid(),batchId:z.uuid(),name:z.string().trim().min(1).max(120),
 slug:z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
 description:z.string().max(2000).default(""),
 visibility:z.enum(["public","private"]).default("public"),
 authMode:z.enum(["anonymous","email","account"]).default("anonymous"),
 startsAt:z.number().int().nonnegative().nullable().default(null),
 endsAt:z.number().int().nonnegative().nullable().default(null),
 totalLimit:z.number().int().min(1).max(1000000).nullable().default(null),
 perPersonLimit:z.number().int().min(1).max(1000).default(1),
 conditions:z.unknown().describe("Condition tree: {type: always}, or nested {type: and|or, children: [...]}. Supports authenticated, verified_email, email, email_domain, passphrase, invitation, time, purchase, question, external. Maximum depth 8 and 100 nodes. See API conditions documentation for leaf fields."),
}).strict().refine(v=>v.startsAt===null||v.endsAt===null||v.startsAt<v.endsAt,{message:"INVALID_CAMPAIGN_WINDOW"});
export function parseCampaign(raw:unknown){const input=campaignInput.parse(raw);return {...input,conditions:parseCondition(input.conditions)};}
export interface CampaignRow {
 id:string;product_id:string;batch_id:string;name:string;slug:string;description:string;
 status:"draft"|"active"|"paused"|"archived";visibility:"public"|"private";auth_mode:"anonymous"|"email"|"account";
 conditions_json:string;starts_at:number|null;ends_at:number|null;total_limit:number|null;
 per_person_limit:number;claimed_count:number;version:number;created_at:number;updated_at:number;
}
export type Campaign=Omit<CampaignRow,"conditions_json">&{conditions:Condition};
function decode(row:CampaignRow):Campaign{const {conditions_json,...rest}=row;return {...rest,conditions:parseCondition(JSON.parse(conditions_json))};}
export async function getCampaign(db:D1Database,id:string):Promise<Campaign|null>{
 z.uuid().parse(id);const row=await db.prepare("SELECT * FROM campaigns WHERE id=?").bind(id).first<CampaignRow>();return row?decode(row):null;
}
export async function createCampaign(db:D1Database,raw:unknown){
 const input=parseCampaign(raw);const id=crypto.randomUUID();const now=Date.now();
 const result=await db.prepare(`INSERT INTO campaigns (id,product_id,batch_id,name,slug,description,visibility,auth_mode,conditions_json,starts_at,ends_at,total_limit,per_person_limit,created_at,updated_at)
 SELECT ?,p.id,b.id,?,?,?,?,?,?,?,?,?,?,?,? FROM products p JOIN code_batches b ON b.product_id=p.id WHERE p.id=? AND b.id=? AND p.archived_at IS NULL`)
 .bind(id,input.name,input.slug,input.description,input.visibility,input.authMode,JSON.stringify(input.conditions),input.startsAt,input.endsAt,input.totalLimit,input.perPersonLimit,now,now,input.productId,input.batchId).run();
 if(!result.meta.changes)throw new Error("CAMPAIGN_SOURCE_UNAVAILABLE");
 return {id,version:1};
}
export async function updateCampaign(db:D1Database,id:string,version:number,raw:unknown){
 z.uuid().parse(id);z.number().int().min(1).parse(version);const input=parseCampaign(raw);
 // 發碼來源固定，避免既有領取紀錄在活動編輯後變成另一種商品或批次。
 const result=await db.prepare(`UPDATE campaigns SET name=?,slug=?,description=?,visibility=?,auth_mode=?,conditions_json=?,starts_at=?,ends_at=?,total_limit=?,per_person_limit=?,updated_at=?,version=version+1
 WHERE id=? AND version=? AND product_id=? AND batch_id=?
 AND (? IS NULL OR claimed_count<=?)`)
 .bind(input.name,input.slug,input.description,input.visibility,input.authMode,JSON.stringify(input.conditions),input.startsAt,input.endsAt,input.totalLimit,input.perPersonLimit,Date.now(),id,version,input.productId,input.batchId,input.totalLimit,input.totalLimit).run();
 if(!result.meta.changes)throw new Error("CAMPAIGN_CONFLICT");return {id,version:version+1};
}
export async function setCampaignStatus(db:D1Database,id:string,version:number,status:CampaignRow["status"]){
 z.uuid().parse(id);z.number().int().min(1).parse(version);z.enum(["draft","active","paused","archived"]).parse(status);
 const result=await db.prepare(`UPDATE campaigns SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND (?!='active' OR EXISTS(SELECT 1 FROM products p WHERE p.id=campaigns.product_id AND p.archived_at IS NULL))`)
 .bind(status,Date.now(),id,version,status).run();
 if(!result.meta.changes)throw new Error("CAMPAIGN_CONFLICT");return {id,version:version+1};
}
export async function listCampaigns(db:D1Database,raw:unknown){
 const q=z.object({productId:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).default(1)}).parse(raw);
 const where=q.productId?"WHERE product_id=?":"";const args=q.productId?[q.productId]:[];
 const count=await db.prepare(`SELECT count(*) AS total FROM campaigns ${where}`).bind(...args).first<{total:number}>();
 const {results}=await db.prepare(`SELECT * FROM campaigns ${where} ORDER BY created_at DESC,id LIMIT 20 OFFSET ?`).bind(...args,(q.page-1)*20).all<CampaignRow>();
 return {campaigns:results.map(decode),total:count?.total??0,page:q.page,pageSize:20};
}
