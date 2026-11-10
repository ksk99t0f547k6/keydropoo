import {identityHash,browserIdentity} from "./claim-identity";
export async function orderIdentity(cookie:string|null,userId:string|undefined,secret:string,appUrl:string){
 const browser=await browserIdentity(cookie,secret,appUrl.startsWith("https:"));
 const browserKey=await identityHash(secret,`order:browser:${browser.id}`);
 const userKey=userId?await identityHash(secret,`order:user:${userId}`):null;
 return {browserKey,userKey,buyerKey:userKey??browserKey,allowedKeys:userKey?[userKey,browserKey]:[browserKey],setCookie:browser.setCookie};
}
