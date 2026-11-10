import {z} from "zod";
import {endpointUrl} from "./eligibility-http";
export const webhookTypes=['code.assigned','code.claimed','code.redeemed','code.revoked','order.delivered','order.refunded'] as const;
export const webhookEndpointInput=z.object({
 name:z.string().trim().min(1).max(120),url:z.string().max(2048),secretName:z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
 events:z.array(z.enum(webhookTypes)).min(1).max(webhookTypes.length).refine(v=>new Set(v).size===v.length),
 productIds:z.array(z.uuid()).min(1).max(1000).refine(v=>new Set(v).size===v.length).nullable(),
}).strict();
export async function createWebhookEndpoint(db:D1Database,raw:unknown){
 const input=webhookEndpointInput.parse(raw);let url:string;
 try{url=endpointUrl(input.url).href;}catch{throw new Error('WEBHOOK_URL_INVALID');}
 if(input.productIds){
  const row=await db.prepare('SELECT count(*) n FROM products WHERE id IN(SELECT value FROM json_each(?))').bind(JSON.stringify(input.productIds)).first<{n:number}>();
  if(row?.n!==input.productIds.length)throw new Error('WEBHOOK_PRODUCTS_INVALID');
 }
 const id=crypto.randomUUID();
 // 地址與訂閱範圍固定；改設定應另建端點，不把舊事件轉送新接收者。
 await db.prepare('INSERT INTO webhook_endpoints(id,name,url,secret_name,events_json,products_json,enabled,created_at) VALUES(?,?,?,?,?,?,0,?)')
 .bind(id,input.name,url,input.secretName,JSON.stringify(input.events),input.productIds===null?null:JSON.stringify(input.productIds),Date.now()).run();
 return {id,enabled:false};
}
export async function setWebhookEnabled(db:D1Database,id:string,enabled:boolean,secrets:Readonly<Record<string,string>>){
 z.uuid().parse(id);z.boolean().parse(enabled);
 const endpoint=await db.prepare('SELECT secret_name FROM webhook_endpoints WHERE id=?').bind(id).first<{secret_name:string}>();
 if(!endpoint)throw new Error('WEBHOOK_NOT_FOUND');
 if(enabled&&(!Object.hasOwn(secrets,endpoint.secret_name)||!/^[a-f0-9]{64}$/i.test(secrets[endpoint.secret_name])))throw new Error('WEBHOOK_SECRET_MISSING');
 await db.prepare('UPDATE webhook_endpoints SET enabled=? WHERE id=?').bind(Number(enabled),id).run();
 return {id,enabled};
}
export async function listWebhookEndpoints(db:D1Database){
 const {results}=await db.prepare('SELECT id,name,url,secret_name,events_json,products_json,enabled,created_at FROM webhook_endpoints ORDER BY created_at DESC,id').all<{id:string;name:string;url:string;secret_name:string;events_json:string;products_json:string|null;enabled:number;created_at:number}>();
 return results.map(({events_json,products_json,...row})=>({...row,events:JSON.parse(events_json) as string[],productIds:products_json===null?null:JSON.parse(products_json) as string[]}));
}
export async function listWebhookDeliveries(db:D1Database,raw:unknown){
 const input=z.object({endpointId:z.uuid(),page:z.coerce.number().int().min(1).max(100000).default(1)}).strict().parse(raw);
 const count=await db.prepare('SELECT count(*) n FROM webhook_deliveries WHERE endpoint_id=?').bind(input.endpointId).first<{n:number}>();
 const {results}=await db.prepare(`SELECT d.id,d.event_id,d.status,d.attempts,d.total_attempts,d.retry_count,d.next_attempt_at,d.last_status,d.delivered_at,v.type,v.product_id,v.created_at
  FROM webhook_deliveries d JOIN webhook_events v ON v.id=d.event_id WHERE d.endpoint_id=? ORDER BY v.created_at DESC,d.id LIMIT 20 OFFSET ?`)
 .bind(input.endpointId,(input.page-1)*20).all();
 return {deliveries:results,total:count?.n??0,page:input.page,pageSize:20};
}
export async function retryWebhookDelivery(db:D1Database,endpointId:string,id:string){
 z.uuid().parse(endpointId);z.string().regex(/^[a-f0-9]{32}$/).parse(id);
 const changed=await db.prepare(`UPDATE webhook_deliveries SET status='pending',attempts=0,retry_count=retry_count+1,next_attempt_at=?,lease_token=NULL,lease_until=NULL
  WHERE id=? AND endpoint_id=? AND status='failed' AND EXISTS(SELECT 1 FROM webhook_endpoints e WHERE e.id=endpoint_id AND e.enabled=1)`)
 .bind(Date.now(),id,endpointId).run();
 if(!changed.meta.changes)throw new Error('WEBHOOK_RETRY_UNAVAILABLE');
 return {queued:true};
}
