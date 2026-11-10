import {z} from 'zod';

export async function listAdminNotifications(db:D1Database,raw:unknown){
 const input=z.object({page:z.number().int().min(1).max(100000).default(1),status:z.enum(['open','resolved']).default('open')}).strict().parse(raw);
 const {results}=await db.prepare(`SELECT n.id,n.type,n.product_id,n.operation_id,n.reason,n.occurrences,n.created_at,n.updated_at,n.resolved_at,p.name AS product_name,e.status AS email_status
 FROM admin_notifications n JOIN products p ON p.id=n.product_id
 LEFT JOIN admin_notification_emails e ON e.notification_id=n.id AND e.occurrence=n.occurrences
 WHERE (n.resolved_at IS NULL)=? ORDER BY n.updated_at DESC,n.id LIMIT 26 OFFSET ?`)
 .bind(Number(input.status==='open'),(input.page-1)*25).all<{id:string;type:string;product_id:string;operation_id:string;reason:string;occurrences:number;created_at:number;updated_at:number;resolved_at:number|null;product_name:string;email_status:string|null}>();
 return {items:results.slice(0,25),hasMore:results.length>25,page:input.page,status:input.status};
}

export function notificationKind(type:string,reason:string){
 if(type==='external_revocation_required')return 'revocation' as const;
 if(type==='external_redemption_failed')return reason==='EXTERNAL_REDEMPTION_FAILED'?'rejected' as const:'unknown' as const;
 return 'other' as const;
}
