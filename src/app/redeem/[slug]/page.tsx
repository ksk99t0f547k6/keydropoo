import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {notFound} from "next/navigation";
import Link from "next/link";
import {getTranslations} from "next-intl/server";
import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {signInLink} from "@/lib/domain/auth-navigation";
import {RedeemForm} from "@/components/redeem/redeem-form";
import { ProductIcon } from "@/components/products/product-icon";
import { productIconUrl } from "@/lib/domain/product-icon";
export const dynamic="force-dynamic";
export const metadata:Metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Redeem({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const {env,settings}=await runtime();
 const product=await env.DB.prepare("SELECT id,name,icon_version FROM products WHERE slug=? AND archived_at IS NULL").bind(slug).first<{id:string;name:string;icon_version:string|null}>();if(!product)notFound();
 const session=await createAuth(env,settings).api.getSession({headers:await headers()});const t=await getTranslations();
 return <main><header className="site-header"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link></header><section className="dashboard-content max-w-2xl">{product.icon_version&&<ProductIcon url={productIconUrl(product.id,product.icon_version)} className="mb-6 size-16 rounded-2xl"/>}<h1>{t("redeem.title",{product:product.name})}</h1><p className="intro">{t("redeem.description")}</p>{session?<RedeemForm productId={product.id}/>:<Link className="cta" href={signInLink(`/redeem/${slug}`)}>{t("common.signIn")}</Link>}</section><PoweredBy/></main>;
}
