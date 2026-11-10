"use client";
import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import {useEffect,useState,type FormEvent} from "react";
import Link from "next/link";
import {useTranslations} from "next-intl";
import {Input} from "@/components/motion/input";
import {Button} from "@/components/motion/button/base";
import {Checkbox} from "@/components/motion/checkbox";
import {Choice} from "@/components/inventory/choice";
import {siteFeatures} from "@/config/site";
import {GuestEmail} from "@/components/claims/guest-email";
import {SignOut} from "@/components/auth/sign-out";
import {signInLink} from "@/lib/domain/auth-navigation";
import type {publicCampaign} from "@/lib/server/public-campaigns";
type PublicCampaign=NonNullable<Awaited<ReturnType<typeof publicCampaign>>>;
type Result={id:string;code:string;status:string;createdAt:number;canLink:boolean;emailAvailable?:boolean};
export function ClaimPage({slug,viewer}:{slug:string;viewer:{emailVerified:boolean}|null}){
 const t=useTranslations("claim");const common=useTranslations("common");const[campaign,setCampaign]=useState<PublicCampaign|null>(null);const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[result,setResult]=useState<Result|null>(null);
 const[savedToAccount,setSavedToAccount]=useState(false);
 const[token,setToken]=useState<string|undefined>();const[requestId,setRequestId]=useState("");const[answers,setAnswers]=useState<Record<string,string|string[]>>({});const[passphrases,setPassphrases]=useState<Record<string,string>>({});const[invitations,setInvitations]=useState<Record<string,string>>({});
 useEffect(()=>{
  // eslint-disable-next-line react-hooks/set-state-in-effect -- hash 與 sessionStorage 僅於掛載後可讀；初始化領取身分且不保存明文碼。
  const abort=new AbortController();const linkToken=new URLSearchParams(window.location.hash.slice(1)).get("token")??undefined;setToken(linkToken);
  // 僅保存請求識別，重新載入可重試；不把明文碼或口令放進瀏覽器儲存。
  const storageKey=`keydrop-claim:${slug}`;
  let key=crypto.randomUUID() as string;try{const old=sessionStorage.getItem(storageKey);if(old&&/^[a-f0-9-]{36}$/.test(old))key=old;else sessionStorage.setItem(storageKey,key);}catch{}
  setRequestId(key);
  async function load(){
   try{
    let savedCampaign:string|null=null;try{savedCampaign=sessionStorage.getItem(`${storageKey}:campaign`);}catch{}
    if(savedCampaign&&/^[a-f0-9-]{36}$/.test(savedCampaign)){
     const recover=()=>fetch("/api/claims",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({campaignId:savedCampaign,idempotencyKey:key,recoveryOnly:true}),signal:abort.signal});
     let response=await recover();if(response.status===428)response=await recover();
     if(response.ok){const previous=await response.json() as Result;if(!abort.signal.aborted){setResult(previous);setCampaign({id:savedCampaign,name:t("title"),description:"",authMode:"anonymous",questions:[],credentials:[]});}return;}
    }
    const response=await fetch("/api/campaign-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({slug,token:linkToken}),signal:abort.signal});
    if(!response.ok)throw new Error();const data=await response.json() as PublicCampaign;
    if(!abort.signal.aborted){setCampaign(data);try{sessionStorage.setItem(`${storageKey}:campaign`,data.id);}catch{}}
   }catch{if(!abort.signal.aborted)setError(t("unavailable"));}finally{if(!abort.signal.aborted)setLoading(false);}
  }
  void load();
  return ()=>abort.abort();
 },[slug,t]);
 async function submit(event:FormEvent){
  event.preventDefault();if(!campaign)return;setBusy(true);setError("");
  try{
   const payload={campaignId:campaign.id,idempotencyKey:requestId,linkToken:token,answers,passphrases,invitations};
   const send=()=>fetch("/api/claims",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   let response=await send();if(response.status===428)response=await send();
   const data=await response.json() as Result&{error?:string};
   if(!response.ok){const code=data.error??"";setError(t(["CLAIM_LOGIN_REQUIRED","CLAIM_VERIFIED_EMAIL_REQUIRED","RATE_LIMITED","CONDITIONS_NOT_MET","QUALIFICATION_UNAVAILABLE","CLAIM_UNAVAILABLE","CLAIM_LINK_UNAVAILABLE"].includes(code)?code:"failed"));return;}
   setResult(data);setPassphrases({});setInvitations({});
  }catch{setError(t("failed"));}finally{setBusy(false);}
 }
 async function saveToAccount(){
  if(!result)return;setBusy(true);setError('');
  try{
   const response=await fetch(`/api/claims/${result.id}/link`,{method:'POST'});
   if(response.status===401){window.location.assign(signInLink(`/claim/${slug}${token?`#token=${token}`:''}`));return;}
   const data=await response.json() as {error?:string};
   if(!response.ok){setError(t(data.error==='CLAIM_VERIFIED_EMAIL_REQUIRED'?'saveVerificationRequired':data.error==='CLAIM_LINK_LIMIT_REACHED'?'saveLimitReached':'saveFailed'));return;}
   setResult({...result,canLink:false});setSavedToAccount(true);
  }catch{setError(t('saveFailed'));}finally{setBusy(false);}
 }
 const authHint=viewer?(campaign?.authMode==="email"&&!viewer.emailVerified?"verifyEmail":"signedIn"):`auth.${campaign?.authMode??"anonymous"}`;
 const loginRequired=!viewer&&campaign?.authMode!=="anonymous";
 const loginUrl=signInLink(`/claim/${slug}${token?`#token=${token}`:""}`);
 return <main><header className="site-header"><Link className="wordmark" href="/"><BrandWordmark label={common("brand")}/></Link><div className="flex items-center gap-5">{siteFeatures.myCodes&&<Link href="/my-codes">{t("myCodes")}</Link>}{viewer?<SignOut/>:!loading&&<Link href={loginUrl}>{t("signIn")}</Link>}</div></header><section className="dashboard-content max-w-2xl">
  <h1>{campaign?.name??t("title")}</h1>{loading?<p role="status">{t("loading")}</p>:campaign&&<><p className="intro">{campaign.description}</p>{!result&&<p className="mb-6 text-sm text-muted-foreground">{t(authHint)}</p>}
  {result?<div className="space-y-5 rounded-xl border border-border p-6"><h2 className="text-xl">{t("success")}</h2><code className="block break-all rounded-lg bg-muted p-4 text-xl">{result.code}</code><p>{t("status",{status:result.status})}</p><p className="text-sm text-muted-foreground">{t("keepSafe")}</p>{result.canLink&&result.emailAvailable&&<GuestEmail claimId={result.id}/>}{savedToAccount&&<p role="status">{t("savedToAccount")}</p>}{result.canLink&&<div className="space-y-3"><p className="text-sm text-muted-foreground">{t("saveExplanation")}</p><Button type="button" disabled={busy} onClick={saveToAccount}>{t(busy?"working":"saveToAccount")}</Button></div>}</div>:<form onSubmit={submit} className="space-y-6"><fieldset disabled={busy} className="space-y-6">
   {campaign.questions.map(q=><section key={q.id} className="space-y-3"><h2 className="font-medium">{q.label}</h2>{q.kind==="text"?<Input label={q.label} value={typeof answers[q.id]==="string"?answers[q.id] as string:""} onChange={value=>setAnswers(a=>({...a,[q.id]:value}))} maxLength={2000}/>:q.kind==="single"?<Choice label={q.label} value={typeof answers[q.id]==="string"?String(q.options.indexOf(answers[q.id] as string)):"-1"} disabled={busy} options={[{value:"-1",label:t("choose")},...q.options.map((label,i)=>({value:String(i),label}))]} onChange={v=>setAnswers(a=>({...a,[q.id]:Number(v)<0?"":q.options[Number(v)]}))}/>:q.options.map(option=><Checkbox key={option} label={option} checked={Array.isArray(answers[q.id])&&(answers[q.id] as string[]).includes(option)} onCheckedChange={checked=>setAnswers(a=>{const selected=Array.isArray(a[q.id])?a[q.id] as string[]:[];return {...a,[q.id]:checked?[...selected,option]:selected.filter(v=>v!==option)};})}/>)}</section>)}
   {campaign.credentials.map(c=><Input key={`${c.type}:${c.id}`} type="password" autoComplete="off" maxLength={128} label={t(c.type,{id:c.id})} value={(c.type==="passphrase"?passphrases:invitations)[c.id]??""} onChange={v=>(c.type==="passphrase"?setPassphrases:setInvitations)(previous=>({...previous,[c.id]:v}))}/>)}
   {loginRequired?<Link className="cta" href={loginUrl}>{t("signIn")}</Link>:<Button type="submit" disabled={busy||!requestId}>{t(busy?"working":"submit")}</Button>}
  </fieldset></form>}</>}
  {error&&<p role="alert" className="mt-5 text-red-600">{error}</p>}
 </section><PoweredBy/></main>;
}
