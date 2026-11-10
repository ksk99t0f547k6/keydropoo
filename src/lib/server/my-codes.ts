import {z} from "zod";
import {encryptionKey,openCode} from "../domain/codes";
export async function listMyCodes(db:D1Database,secret:string,userId:string,page=1){
 z.string().min(1).max(128).parse(userId);z.number().int().min(1).max(100000).parse(page);
 const holdings=`WITH holdings AS (
 SELECT id,created_at,code_id,campaign_id,'claim' AS source,NULL AS access_revoked_at FROM claims WHERE user_id=?
 UNION ALL SELECT id,created_at,code_id,NULL AS campaign_id,'purchase' AS source,access_revoked_at FROM orders WHERE user_id=? AND code_id IS NOT NULL
 UNION ALL SELECT id,created_at,code_id,NULL,'assignment',NULL FROM code_assignments WHERE user_id=?
 UNION ALL SELECT id,created_at,code_id,NULL,'email',NULL FROM email_distributions WHERE user_id=?
 )`;
 const count=await db.prepare(`${holdings} SELECT count(*) AS total FROM holdings`).bind(userId,userId,userId,userId).first<{total:number}>();
 const {results}=await db.prepare(`${holdings} SELECT h.id,h.created_at,h.source,c.id AS code_id,c.product_id,CASE WHEN h.access_revoked_at IS NULL THEN c.ciphertext ELSE NULL END AS ciphertext,CASE WHEN h.access_revoked_at IS NOT NULL THEN 'revoked' ELSE c.status END AS status,c.expires_at,p.name AS product_name,p.slug AS product_slug,b.kind,ca.name AS campaign_name
 FROM holdings h JOIN codes c ON c.id=h.code_id JOIN products p ON p.id=c.product_id JOIN code_batches b ON b.id=c.batch_id LEFT JOIN campaigns ca ON ca.id=h.campaign_id
 ORDER BY h.created_at DESC,h.id LIMIT 20 OFFSET ?`).bind(userId,userId,userId,userId,(page-1)*20).all<{id:string;created_at:number;source:"claim"|"purchase"|"assignment"|"email";code_id:string;product_id:string;ciphertext:string|null;status:string;expires_at:number|null;product_name:string;product_slug:string;kind:string;campaign_name:string|null}>();
 const key=await encryptionKey(secret);
 return {total:count?.total??0,page,items:await Promise.all(results.map(async({ciphertext,code_id,product_id,...row})=>({...row,codeId:code_id,code:ciphertext?await openCode(ciphertext,key,`${product_id}:${code_id}`):null})))};
}
