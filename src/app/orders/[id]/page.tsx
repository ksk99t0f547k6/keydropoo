import { PoweredBy } from "@/components/site/powered-by";
import { BrandWordmark } from "@/components/site/brand-logo";
import type {Metadata} from "next";
import {headers} from "next/headers";
import {notFound} from "next/navigation";
import Link from "next/link";
import {getTranslations} from "next-intl/server";
import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
import {orderIdentity} from "@/lib/server/order-identity";
import {getOrder,deliverOrder} from "@/lib/server/orders";
import {OrderStatus} from "@/components/checkout/order-status";
import {z} from "zod";
export const dynamic="force-dynamic";
export const metadata:Metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Order({params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const {env,settings}=await runtime(),requestHeaders=await headers();const session=await createAuth(env,settings).api.getSession({headers:requestHeaders});
 const actor=await orderIdentity(requestHeaders.get("cookie"),session?.user.id,settings.BETTER_AUTH_SECRET,settings.APP_URL),order=await getOrder(env.DB,id);
 if(!order||!actor.allowedKeys.includes(order.buyer_key))notFound();
 const product=await env.DB.prepare("SELECT p.name,p.slug,b.kind FROM products p JOIN code_batches b ON b.product_id=p.id WHERE p.id=? AND b.id=?").bind(order.product_id,order.batch_id).first<{name:string;slug:string;kind:string}>();if(!product)notFound();
 const initial=await deliverOrder(env.DB,env.CODE_ENCRYPTION_KEY??"",id,order.buyer_key),t=await getTranslations();
 return <main><header className="site-header"><Link className="wordmark" href="/"><BrandWordmark label={t("common.brand")}/></Link></header><section className="dashboard-content max-w-2xl"><p className="eyebrow">{t("order.eyebrow")}</p><h1>{product.name}</h1><OrderStatus signedIn={!!session} initial={initial} slug={product.slug} kind={product.kind}/></section><PoweredBy/></main>;
}
