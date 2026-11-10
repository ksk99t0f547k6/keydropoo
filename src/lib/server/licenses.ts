import {z} from "zod";
import {encryptionKey,fingerprint,sealCode,openCode} from "../domain/codes";
import {identityHash} from "./claim-identity";
export const activationInput=z.object({productId:z.uuid(),code:z.string().min(1).max(512),deviceId:z.string().min(1).max(512),label:z.string().max(120).default("")}).strict();
interface Device {user_id:string|null;id:string;code_id:string;device_hash:string;token_ciphertext:string;released_at:number|null;activated_at:number;}
export async function activateLicense(db:D1Database,encryptionSecret:string,identitySecret:string,raw:unknown,now=Date.now(),ownerUserId?:string){
 if(ownerUserId!==undefined)z.string().min(1).max(128).parse(ownerUserId);
 const input=activationInput.parse(raw);const key=await encryptionKey(encryptionSecret);
 const code=await db.prepare(`SELECT c.id,c.expires_at,b.distribution_mode FROM codes c JOIN code_batches b ON b.id=c.batch_id JOIN products p ON p.id=c.product_id
 WHERE c.product_id=? AND c.fingerprint=? AND b.kind='license' AND c.status IN ('available','assigned') AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>?)`).bind(input.productId,await fingerprint(input.code),now).first<{id:string;expires_at:number|null;distribution_mode:"unique"|"shared"}>();
 if(!code)throw new Error("LICENSE_ACTIVATION_UNAVAILABLE");
 const userId=code.distribution_mode==='shared'?ownerUserId??null:null;
 if(code.distribution_mode==='shared'&&(!userId||!await db.prepare('SELECT h.user_id FROM license_holders h JOIN "user" u ON u.id=h.user_id WHERE h.code_id=? AND h.user_id=?').bind(code.id,userId).first()))throw new Error("LICENSE_OWNER_REQUIRED");
 const deviceHash=await identityHash(identitySecret,deviceIdentity(code.id,input.deviceId,userId));
 async function current(){return db.prepare("SELECT * FROM license_devices WHERE code_id=? AND device_hash=?").bind(code!.id,deviceHash).first<Device>();}
 async function deliver(device:Device){
  // 再查一次即時狀態，避免重試路徑繞過已撤銷／到期／封存。
  const valid=await db.prepare("SELECT c.id FROM codes c JOIN products p ON p.id=c.product_id JOIN license_devices d ON d.code_id=c.id WHERE c.id=? AND d.id=? AND d.released_at IS NULL AND c.status='assigned' AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>?) AND (d.user_id IS NULL OR EXISTS(SELECT 1 FROM license_holders h WHERE h.code_id=c.id AND h.user_id=d.user_id))").bind(code!.id,device.id,now).first();
  if(!valid)throw new Error("LICENSE_ACTIVATION_UNAVAILABLE");
  return {activationId:device.id,activationToken:await openCode(device.token_ciphertext,key,`license:${device.id}`),expiresAt:code!.expires_at};
 }
 const previous=await current();if(previous&&previous.released_at===null)return deliver(previous);
 const id=previous?.id??crypto.randomUUID();const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,"0")).join("");
 const hash=await fingerprint(token);const ciphertext=await sealCode(token,key,`license:${id}`);
 try{
  if(previous)await db.prepare("UPDATE license_devices SET token_hash=?,token_ciphertext=?,label=?,activated_at=?,released_at=NULL WHERE id=? AND released_at IS NOT NULL").bind(hash,ciphertext,input.label,now,id).run();
  else await db.prepare("INSERT INTO license_devices(id,code_id,device_hash,label,token_hash,token_ciphertext,activated_at,user_id) VALUES(?,?,?,?,?,?,?,?)").bind(id,code.id,deviceHash,input.label,hash,ciphertext,now,userId).run();
 }catch(error){const replay=await current();if(replay&&replay.released_at===null)return deliver(replay);throw error;}
 return deliver((await current())!);
}
// 用 JSON 分隔共享帳號與裝置 ID，避免冒號等字元造成不同身分的輸入碰撞。
function deviceIdentity(codeId:string,deviceId:string,userId:string|null){return userId===null?`license-device:${codeId}:${deviceId}`:`shared-license-device:${JSON.stringify([codeId,userId,deviceId])}`;}
const proofInput=z.object({productId:z.uuid(),activationToken:z.string().regex(/^[a-f0-9]{64}$/),deviceId:z.string().min(1).max(512)}).strict();
async function deviceProof(db:D1Database,identitySecret:string,raw:unknown){
 const input=proofInput.parse(raw);
 const device=await db.prepare("SELECT d.id,d.code_id,d.device_hash,d.released_at,d.user_id FROM license_devices d JOIN codes c ON c.id=d.code_id WHERE d.token_hash=? AND c.product_id=?").bind(await fingerprint(input.activationToken),input.productId).first<{id:string;code_id:string;device_hash:string;released_at:number|null;user_id:string|null}>();
 if(!device||device.device_hash!==await identityHash(identitySecret,deviceIdentity(device.code_id,input.deviceId,device.user_id)))throw new Error("INVALID_LICENSE_PROOF");
 return device;
}
export async function validateLicense(db:D1Database,identitySecret:string,raw:unknown,now=Date.now()){
 const device=await deviceProof(db,identitySecret,raw);
 const row=await db.prepare("SELECT c.expires_at FROM codes c JOIN products p ON p.id=c.product_id JOIN license_devices d ON d.code_id=c.id WHERE d.id=? AND d.released_at IS NULL AND c.status='assigned' AND p.archived_at IS NULL AND (c.expires_at IS NULL OR c.expires_at>?) AND (d.user_id IS NULL OR EXISTS(SELECT 1 FROM license_holders h WHERE h.code_id=c.id AND h.user_id=d.user_id))").bind(device.id,now).first<{expires_at:number|null}>();
 return {valid:!!row,activationId:device.id,expiresAt:row?.expires_at??null};
}
export async function releaseLicense(db:D1Database,identitySecret:string,raw:unknown){
 const device=await deviceProof(db,identitySecret,raw);
 await db.prepare("UPDATE license_devices SET released_at=? WHERE id=? AND released_at IS NULL").bind(Date.now(),device.id).run();return {released:true};
}
// 網頁自助與管理操作不接受裝置 ID 作授權；必須有帳號持有關係或管理權。
export async function releaseOwnedDevice(db:D1Database,activationId:string,userId:string,admin=false){
 z.uuid().parse(activationId);z.string().min(1).max(128).parse(userId);
 const row=await db.prepare("SELECT d.id FROM license_devices d WHERE d.id=? AND (?=1 OR d.user_id=? OR (d.user_id IS NULL AND (EXISTS(SELECT 1 FROM code_recipients cl WHERE cl.code_id=d.code_id AND cl.user_id=?) OR EXISTS(SELECT 1 FROM orders o WHERE o.code_id=d.code_id AND o.user_id=?))))").bind(activationId,Number(admin),userId,userId,userId).first();
 if(!row)throw new Error("LICENSE_DEVICE_NOT_FOUND");
 await db.prepare("UPDATE license_devices SET released_at=? WHERE id=? AND released_at IS NULL").bind(Date.now(),activationId).run();return {released:true};
}
export async function listOwnedDevices(db:D1Database,userId:string){
 z.string().min(1).max(128).parse(userId);
 return (await db.prepare("SELECT d.id,d.label,d.activated_at,d.released_at,p.name AS product_name,c.status FROM license_devices d JOIN codes c ON c.id=d.code_id JOIN products p ON p.id=c.product_id WHERE (d.user_id=? OR (d.user_id IS NULL AND (EXISTS(SELECT 1 FROM code_recipients cl WHERE cl.code_id=c.id AND cl.user_id=?) OR EXISTS(SELECT 1 FROM orders o WHERE o.code_id=c.id AND o.user_id=?)))) ORDER BY d.activated_at DESC,d.id LIMIT 1000").bind(userId,userId,userId).all<{id:string;label:string;activated_at:number;released_at:number|null;product_name:string;status:string}>()).results;
}

// 管理 API 以商品範圍授權；只回傳裝置中繼資料，不公開裝置雜湊或啟用憑證。
export async function listProductDevices(db:D1Database,raw:unknown){
 const input=z.object({productId:z.uuid(),codeId:z.uuid().optional(),page:z.number().int().min(1).max(100000).default(1)}).strict().parse(raw);
 const {results}=await db.prepare(`SELECT d.id,d.code_id,d.user_id,d.label,d.activated_at,d.released_at,c.status AS code_status
 FROM license_devices d JOIN codes c ON c.id=d.code_id WHERE c.product_id=? AND (? IS NULL OR c.id=?)
 ORDER BY d.activated_at DESC,d.id LIMIT 51 OFFSET ?`).bind(input.productId,input.codeId??null,input.codeId??null,(input.page-1)*50)
 .all<{id:string;code_id:string;user_id:string|null;label:string;activated_at:number;released_at:number|null;code_status:string}>();
 return {devices:results.slice(0,50),page:input.page,hasMore:results.length>50};
}
export async function releaseProductDevice(db:D1Database,productId:string,activationId:string){
 z.uuid().parse(productId);z.uuid().parse(activationId);
 const row=await db.prepare(`UPDATE license_devices SET released_at=COALESCE(released_at,?)
 WHERE id=? AND EXISTS(SELECT 1 FROM codes c WHERE c.id=license_devices.code_id AND c.product_id=?) RETURNING id,released_at`)
 .bind(Date.now(),activationId,productId).first<{id:string;released_at:number}>();
 if(!row)throw new Error("LICENSE_DEVICE_NOT_FOUND");
 return {released:true,activationId:row.id,releasedAt:row.released_at};
}
