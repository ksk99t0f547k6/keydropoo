import {hashPassword,verifyPassword} from "better-auth/crypto";
import {z} from "zod";
export const campaignCredentialInput=z.object({id:z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),kind:z.enum(["passphrase","invitation"]),secret:z.string().min(8).max(128)}).strict();
export async function saveCampaignCredential(db:D1Database,campaignId:string,raw:unknown){
 z.uuid().parse(campaignId);const input=campaignCredentialInput.parse(raw);
 const hash=await hashPassword(input.secret);
 await db.batch([
  db.prepare("UPDATE campaigns SET version=version+1,updated_at=? WHERE id=?").bind(Date.now(),campaignId),
  db.prepare(`INSERT INTO campaign_credentials(campaign_id,credential_id,kind,secret_hash,revoked_at) VALUES(?,?,?,?,NULL)
 ON CONFLICT(campaign_id,credential_id,kind) DO UPDATE SET secret_hash=excluded.secret_hash,revoked_at=NULL`).bind(campaignId,input.id,input.kind,hash),
 ]);
 return {id:input.id,kind:input.kind};
}
export async function verifyCampaignCredential(db:D1Database,campaignId:string,id:string,secret:string,kind:"passphrase"|"invitation"){
 const row=await db.prepare("SELECT secret_hash FROM campaign_credentials WHERE campaign_id=? AND credential_id=? AND kind=? AND revoked_at IS NULL").bind(campaignId,id,kind).first<{secret_hash:string}>();
 return row?verifyPassword({hash:row.secret_hash,password:secret}):false;
}
export async function revokeCampaignCredential(db:D1Database,campaignId:string,raw:unknown){
 z.uuid().parse(campaignId);const input=campaignCredentialInput.omit({secret:true}).parse(raw);
 await db.batch([
  db.prepare("UPDATE campaigns SET version=version+1,updated_at=? WHERE id=?").bind(Date.now(),campaignId),
  db.prepare("UPDATE campaign_credentials SET revoked_at=? WHERE campaign_id=? AND credential_id=? AND kind=?").bind(Date.now(),campaignId,input.id,input.kind),
 ]);
}
export async function listCampaignCredentials(db:D1Database,campaignId:string){
 z.uuid().parse(campaignId);return (await db.prepare("SELECT credential_id AS id,kind,revoked_at FROM campaign_credentials WHERE campaign_id=? ORDER BY credential_id,kind").bind(campaignId).all<{id:string;kind:"passphrase"|"invitation";revoked_at:number|null}>()).results;
}
