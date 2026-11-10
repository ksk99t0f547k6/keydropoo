// 僅接受已知站內目的地；私密 token 保留在 fragment，不傳給登入端點。
export function safeReturnTo(value:unknown):string {
 if(typeof value!=="string"||value.length>512||!value.startsWith("/")||value.startsWith("//")||/[\\\x00-\x20]/.test(value))return "/dashboard";
 try{
  const url=new URL(value,"https://keydrop.invalid");
  if(url.origin!=="https://keydrop.invalid"||url.search)return "/dashboard";
  if(["/","/dashboard","/dashboard/security","/my-codes","/account/security"].includes(url.pathname)&&!url.hash)return url.pathname;
  if(/^\/orders\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(url.pathname)&&!url.hash)return url.pathname;
  if(/^\/(?:redeem|buy)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname)&&!url.hash)return url.pathname;
  if(/^\/claim\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname)&&(!url.hash||/^#token=[a-f0-9]{64}$/.test(url.hash)))return `${url.pathname}${url.hash}`;
 }catch{}
 return "/dashboard";
}
export function returnFromHash(hash:string){return safeReturnTo(new URLSearchParams(hash.replace(/^#/,"")).get("returnTo"));}
export function signInLink(destination:string){return `/sign-in#${new URLSearchParams({returnTo:safeReturnTo(destination)})}`;}
