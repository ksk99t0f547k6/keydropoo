import {z} from "zod";
import {fingerprint} from "../domain/codes";
export const scopes=["discounts:read","discounts:write","products:read","products:write","codes:read","codes:write","codes:issue","codes:redeem","campaigns:read","campaigns:write","credits:read","credits:write","entitlements:read","rewards:read","rewards:write","licenses:manage"] as const;
export type ApiScope=typeof scopes[number];
const tokenInput=z.object({mcpWriteEnabled:z.boolean().default(false),name:z.string().trim().min(1).max(120),scopes:z.array(z.enum(scopes)).min(1).max(scopes.length).refine(v=>new Set(v).size===v.length),productIds:z.array(z.uuid()).min(1).max(1000).refine(v=>new Set(v).size===v.length).nullable(),expiresAt:z.number().int().positive().nullable().default(null)}).strict();
export async function createApiToken(db:D1Database,raw:unknown,now=Date.now()){
 const input=tokenInput.parse(raw);if(input.expiresAt!==null&&input.expiresAt<=now)throw new Error("TOKEN_EXPIRY_INVALID");
 if(input.productIds){const row=await db.prepare("SELECT count(*) AS total FROM products WHERE id IN(SELECT value FROM json_each(?))").bind(JSON.stringify(input.productIds)).first<{total:number}>();if(row?.total!==input.productIds.length)throw new Error("TOKEN_PRODUCTS_INVALID");}
 const token=`kd_${Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,"0")).join("")}`;const id=crypto.randomUUID();
 await db.prepare("INSERT INTO api_tokens(id,name,token_hash,scopes_json,products_json,expires_at,created_at,mcp_write_enabled) VALUES(?,?,?,?,?,?,?,?)").bind(id,input.name,await fingerprint(token),JSON.stringify(input.scopes),input.productIds===null?null:JSON.stringify(input.productIds),input.expiresAt,now,Number(input.mcpWriteEnabled)).run();
 return {id,token,name:input.name,scopes:input.scopes,productIds:input.productIds,expiresAt:input.expiresAt,mcpWriteEnabled:input.mcpWriteEnabled};
}
export interface ApiPrincipal {id:string;mcpWriteEnabled:boolean;scopes:ApiScope[];productIds:string[]|null;}
export async function authenticateApiToken(db:D1Database,authorization:string|null,now=Date.now()):Promise<ApiPrincipal>{
 if(!authorization||!/^Bearer kd_[a-f0-9]{64}$/.test(authorization))throw new Error("INVALID_API_TOKEN");
 const row=await db.prepare("SELECT id,scopes_json,products_json,mcp_write_enabled FROM api_tokens WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)").bind(await fingerprint(authorization.slice(7)),now).first<{id:string;scopes_json:string;products_json:string|null;mcp_write_enabled:number}>();
 if(!row)throw new Error("INVALID_API_TOKEN");
 await db.prepare("UPDATE api_tokens SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<?)").bind(now,row.id,now-60000).run();
 return {id:row.id,mcpWriteEnabled:row.mcp_write_enabled===1,scopes:z.array(z.enum(scopes)).parse(JSON.parse(row.scopes_json)),productIds:row.products_json===null?null:z.array(z.uuid()).parse(JSON.parse(row.products_json))};
}
export function requireApiScope(principal:ApiPrincipal,scope:ApiScope,productId:string){
 z.uuid().parse(productId);if(!principal.scopes.includes(scope)||(principal.productIds!==null&&!principal.productIds.includes(productId)))throw new Error("API_SCOPE_DENIED");
}
export async function revokeApiToken(db:D1Database,id:string){z.uuid().parse(id);await db.prepare("UPDATE api_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(Date.now(),id).run();}
export async function listApiTokens(db:D1Database){
 const {results}=await db.prepare("SELECT id,name,scopes_json,products_json,expires_at,revoked_at,created_at,last_used_at,mcp_write_enabled FROM api_tokens ORDER BY created_at DESC,id").all<{id:string;name:string;scopes_json:string;products_json:string|null;expires_at:number|null;revoked_at:number|null;created_at:number;last_used_at:number|null;mcp_write_enabled:number}>();
 return results.map(({scopes_json,products_json,...row})=>({...row,scopes:JSON.parse(scopes_json) as ApiScope[],productIds:products_json===null?null:JSON.parse(products_json) as string[]}));
}
