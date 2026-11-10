import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {notFound,redirect} from "next/navigation";
import Link from "next/link";
import {getTranslations} from "next-intl/server";
import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {listMyCodes} from "@/lib/server/my-codes";
import {siteFeatures} from "@/config/site";
import {SignOut} from "@/components/auth/sign-out";
import {DeviceList} from "@/components/claims/device-list";
import {listOwnedDevices} from "@/lib/server/licenses";
import {CodeEmailButton} from "@/components/claims/code-email-button";
import {LinkEmailDistributions} from "@/components/claims/link-email-distributions";
import {latestCodeEmailJobs} from "@/lib/server/code-email";
import {rememberUserLocale} from "@/lib/server/user-locale";
export const dynamic="force-dynamic";
export const metadata:Metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function MyCodes({searchParams}:{searchParams:Promise<{page?:string}>}){
 if(!siteFeatures.myCodes)notFound();
 const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect("/sign-in#returnTo=%2Fmy-codes");
 await rememberUserLocale(env.DB,session.user);
 const {page:raw}=await searchParams;const page=raw&&/^\d+$/.test(raw)?Math.min(100000,Math.max(1,Number(raw))):1;
 const t=await getTranslations();const devices=await listOwnedDevices(env.DB,session.user.id);
 const list=env.CODE_ENCRYPTION_KEY?await listMyCodes(env.DB,env.CODE_ENCRYPTION_KEY,session.user.id,page):{total:0,items:[]};
 const mailEnabled=Boolean(env.EMAIL&&settings.EMAIL_FROM);
 const jobs=mailEnabled?await latestCodeEmailJobs(env.DB,session.user.id,list.items.map(item=>item.codeId)):[];
 // eslint-disable-next-line react-hooks/purity -- 此動態伺服器頁面的請求時間快照；實際有效性仍由 API 判定。
 const now=Date.now();
 return <main><header className="site-header"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link><div className="flex items-center gap-5"><Link className="text-sm underline" href="/account/security">{t("security.title")}</Link><SignOut/></div></header><section className="dashboard-content"><h1>{t("myCodes.title")}</h1><p className="intro">{t("myCodes.description")}</p>{mailEnabled&&<p className="mb-6 text-sm text-muted-foreground">{session.user.emailVerified?t("codeEmail.recipient",{email:session.user.email}):t("codeEmail.verifyHint")} {!session.user.emailVerified&&<Link className="underline" href="/sign-in#returnTo=%2Fmy-codes">{t("codeEmail.verifyLink")}</Link>}</p>}<LinkEmailDistributions verified={session.user.emailVerified}/><div className="space-y-5">
 {list.items.map(item=><article key={item.id} className="space-y-3 rounded-xl border border-border p-5"><h2>{item.product_name}</h2><p className="text-sm text-muted-foreground">{item.campaign_name??t(item.source==="email"?"myCodes.email":item.source==="assignment"?"myCodes.assignment":"myCodes.purchase")}</p>{item.source==="purchase"&&<Link className="underline text-sm" href={`/orders/${item.id}`}>{t("myCodes.viewOrder")}</Link>}<code className="block break-all rounded-lg bg-muted p-4">{item.code??t("inventory.revoked")}</code>{item.kind==="redemption"&&item.status!=="revoked"&&<Link className="inline-block underline" href={`/redeem/${item.product_slug}`}>{t("redeem.submit")}</Link>}<p className="text-sm">{t(`inventory.${item.status}`)} · {new Date(item.created_at).toISOString()}</p>{item.expires_at&&<p className="text-sm">{t("inventory.expires")}: {new Date(item.expires_at).toISOString()}</p>}{mailEnabled&&session.user.emailVerified&&item.status!=="revoked"&&(!item.expires_at||item.expires_at>now)&&<CodeEmailButton codeId={item.codeId} initialJob={jobs.find(job=>job.code_id===item.codeId)}/>}</article>)}
 {!list.items.length&&<p>{t("myCodes.empty")}</p>}</div><nav className="mt-8 flex gap-6">{page>1&&<Link href={`?page=${page-1}`}>{t("inventory.previous")}</Link>}{page*20<list.total&&<Link href={`?page=${page+1}`}>{t("inventory.next")}</Link>}</nav><DeviceList devices={devices}/></section><PoweredBy/></main>;
}
