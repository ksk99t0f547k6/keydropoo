import {APIError} from 'better-auth/api';
import {z} from 'zod';
import {createAuth} from './auth';
import type {RuntimeEnv} from './env';
import type {Settings} from './config';
import {HttpError,readJson} from './http';
import {claimRateLimit} from './claim-identity';

export const passwordSetupFreshMs=15*60*1000;
export function passwordSessionFresh(createdAt:Date|string|number,now=Date.now()){
 const age=now-new Date(createdAt).getTime();
 return Number.isFinite(age)&&age>=0&&age<passwordSetupFreshMs;
}

export async function setAccountPassword(request:Request,env:RuntimeEnv,settings:Settings){
 if(request.headers.get('origin')!==settings.APP_URL)throw new HttpError(403,'INVALID_ORIGIN');
 const input=z.object({newPassword:z.string().min(12).max(128)}).strict().parse(await readJson(request,2048));
 const auth=createAuth(env,settings);
 // 設定持續有效的登入憑證前，重新查詢資料庫中的本人工作階段。
 const session=await auth.api.getSession({headers:request.headers,query:{disableCookieCache:true}});
 if(!session)throw new HttpError(401,'UNAUTHORIZED');
 if(!session.user.emailVerified)throw new HttpError(403,'EMAIL_VERIFICATION_REQUIRED');
 if(!passwordSessionFresh(session.session.createdAt))throw new HttpError(403,'SESSION_NOT_FRESH');
 if(!await claimRateLimit(env.DB,settings.BETTER_AUTH_SECRET,`password-setup:${session.user.id}`,Date.now(),3))throw new HttpError(429,'RATE_LIMITED');
 try{
  // Better Auth 自行雜湊並拒絕覆寫已存在的密碼；不接受客戶端指定 userId。
  await auth.api.setPassword({headers:request.headers,body:input});
 }catch(error){
  if(error instanceof APIError&&error.body?.code==='PASSWORD_ALREADY_SET')throw new HttpError(409,'PASSWORD_ALREADY_SET');
  if(error instanceof APIError&&error.body?.code==='UNAUTHORIZED')throw new HttpError(401,'UNAUTHORIZED');
  throw error;
 }
 return {ok:true};
}

// 帳號安全頁要顯示的狀態；一般使用者頁與後台頁共用。
export async function readSecurityState(db:D1Database,user:{id:string;name:string;email:string;emailVerified:boolean},sessionCreatedAt:Date,emailEnabled:boolean){
 const account=await db.prepare("SELECT id FROM account WHERE userId=? AND providerId='credential' AND password IS NOT NULL").bind(user.id).first();
 const hasPassword=Boolean(account);
 return {name:user.name,email:user.email,hasPassword,needsVerification:!hasPassword&&!user.emailVerified,needsFresh:!hasPassword&&!passwordSessionFresh(sessionCreatedAt),emailEnabled};
}
