const encoder=new TextEncoder();
async function hmacKey(secret:string){if(secret.length<32)throw new Error("IDENTITY_SECRET_NOT_CONFIGURED");return crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);}
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),v=>v.toString(16).padStart(2,"0")).join("");
export async function identityHash(secret:string,value:string){return hex(await crypto.subtle.sign("HMAC",await hmacKey(secret),encoder.encode(value)));}
export async function browserIdentity(cookie:string|null,secret:string,secure:boolean,now=Date.now()){
 const name=secure?"__Host-keydrop-browser":"keydrop-browser";
 const value=cookie?.split(";").map(v=>v.trim()).find(v=>v.startsWith(`${name}=`))?.slice(name.length+1);
 if(value&&value.length<200){
  const match=/^([a-f0-9-]{36})\.(\d{13})\.([a-f0-9]{64})$/.exec(value);
  if(match&&Number(match[2])>now&&Number(match[2])<=now+366*86400000){
   const signature=Uint8Array.from(match[3].match(/../g)!,v=>parseInt(v,16));
   if(await crypto.subtle.verify("HMAC",await hmacKey(secret),signature,encoder.encode(`browser:${match[1]}.${match[2]}`)))return {id:match[1],setCookie:null};
  }
 }
 const id=crypto.randomUUID();const expires=now+365*86400000;const payload=`${id}.${expires}`;const signature=await identityHash(secret,`browser:${payload}`);
 return {id,setCookie:`${name}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure?"; Secure":""}`};
}
// 把來源 IP 換成限制用的網段：IPv4 用完整位址，IPv6 截成 /64。
// 一般 IPv6 用戶手上就有一整個 /64，用完整位址計數等於可以無限換身分。
export function clientNetwork(ip:string){
 const value=ip.trim().toLowerCase();
 const mapped=/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
 if(mapped)return mapped[1];
 if(!value.includes(':'))return value;
 const [head,tail]=value.split('%')[0].split('::');
 const left=head?head.split(':'):[];
 const right=tail===undefined?[]:tail?tail.split(':'):[];
 // 結尾若是內嵌 IPv4，只影響後 64 位元，前四組照常取。
 const groups=tail===undefined?left:[...left,...Array(Math.max(0,8-left.length-right.length)).fill('0'),...right];
 const prefix=groups.slice(0,4).map(g=>(g||'0').replace(/^0+(?=.)/,''));
 while(prefix.length<4)prefix.push('0');
 return `${prefix.join(':')}::/64`;
}
export async function claimRateLimit(db:D1Database,secret:string,ip:string,now=Date.now(),limit=30){
 const key=await identityHash(secret,`claim-rate:${ip}`);const window=Math.floor(now/60000);
 await db.prepare("DELETE FROM claim_rate_limits WHERE expires_at<=?").bind(now).run();
 const row=await db.prepare(`INSERT INTO claim_rate_limits(key,window,count,expires_at) VALUES(?,?,1,?)
 ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN claim_rate_limits.window=excluded.window THEN claim_rate_limits.count+1 ELSE 1 END,expires_at=excluded.expires_at RETURNING count`)
 .bind(key,window,(window+1)*60000).first<{count:number}>();
 return !!row&&row.count<=Math.max(1,Math.min(30,Math.floor(limit)));
}
