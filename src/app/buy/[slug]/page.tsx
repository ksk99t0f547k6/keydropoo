import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {createAuth} from "@/lib/server/auth";
import {siteFeatures} from "@/config/site";
import {notFound} from "next/navigation";
import Link from "next/link";
import {getTranslations,getFormatter} from "next-intl/server";
import {runtime} from "@/lib/server/env";
import {currencyDigits} from "@/lib/domain/money";
import {BuyButton} from "@/components/checkout/buy-button";
import {signInLink} from "@/lib/domain/auth-navigation";
import { ProductIcon } from "@/components/products/product-icon";
import { productIconUrl } from "@/lib/domain/product-icon";
export const dynamic="force-dynamic";
export const metadata:Metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Buy({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 const product=await env.DB.prepare("SELECT id,name,description,price_minor,currency,checkout_batch_id,icon_version FROM products WHERE slug=? AND archived_at IS NULL").bind(slug).first<{id:string;name:string;description:string;price_minor:number;currency:string;checkout_batch_id:string|null;icon_version:string|null}>();if(!product)notFound();
 const t=await getTranslations(),format=await getFormatter();const available=!!product.checkout_batch_id&&product.price_minor>0&&!!env.STRIPE_SECRET_KEY&&!!env.STRIPE_WEBHOOK_SECRET;
 return <main><header className="site-header"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link>{session?(siteFeatures.myCodes&&<Link href="/my-codes">{t("myCodes.title")}</Link>):<Link href={signInLink(`/buy/${slug}`)}>{t("common.signIn")}</Link>}</header><section className="dashboard-content max-w-2xl">{product.icon_version&&<ProductIcon url={productIconUrl(product.id,product.icon_version)} className="mb-6 size-16 rounded-2xl"/>}<p className="eyebrow">{t("purchase.eyebrow")}</p><h1>{product.name}</h1><p className="intro">{product.description||t("purchase.description")}</p><div className="rounded-xl border border-border p-7 space-y-7"><p className="text-3xl">{format.number(product.price_minor/10**currencyDigits(product.currency),{style:"currency",currency:product.currency})}</p><BuyButton productId={product.id} available={available}/></div><p className="mt-6 text-sm text-muted-foreground">{t("purchase.guestHint")}</p></section><PoweredBy/></main>;
}
