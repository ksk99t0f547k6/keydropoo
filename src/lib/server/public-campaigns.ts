import {conditionFields} from "../domain/conditions";
import {fingerprint} from "../domain/codes";
import type {CampaignRow} from "./campaigns";
export async function publicCampaign(db:D1Database,slug:string,token?:string){
 if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)return null;
 const row=await db.prepare("SELECT c.*,b.kind='license' AND b.distribution_mode='shared' AS shared_license FROM campaigns c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id WHERE c.slug=? AND c.status='active' AND p.archived_at IS NULL").bind(slug).first<CampaignRow&{shared_license:number}>();
 if(!row)return null;
 if(row.visibility==="private"||token){
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const link=await db.prepare("SELECT id FROM campaign_links WHERE campaign_id=? AND token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) AND (max_claims IS NULL OR claimed_count<max_claims)").bind(row.id,await fingerprint(token),Date.now()).first();
  if(!link)return null;
 }
 return {id:row.id,name:row.name,description:row.description,authMode:row.shared_license?"account" as const:row.auth_mode,...conditionFields(JSON.parse(row.conditions_json))};
}
