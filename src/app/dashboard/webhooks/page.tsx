import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {runtime} from "@/lib/server/env";
import {createAuth,isAdmin} from "@/lib/server/auth";
import {listWebhookEndpoints} from "@/lib/server/webhook-management";
import {webhookSecrets} from "@/lib/server/webhook-http";
import {WebhookManager} from "@/components/webhooks/webhook-manager";
import {PageHeader} from '@/components/dashboard/page-header';
import {Card,CardContent} from '@/components/motion/card';

export const dynamic="force-dynamic";
export default async function Webhooks(){
 const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect('/sign-in');if(!await isAdmin(env.DB,session.user.id))redirect('/');
 const t=await getTranslations();
 const [endpoints,{results:products}]=await Promise.all([listWebhookEndpoints(env.DB),env.DB.prepare('SELECT id,name FROM products ORDER BY name,id').all<{id:string;name:string}>()]);
 let secretNames:string[]=[];try{secretNames=Object.keys(webhookSecrets(env.WEBHOOK_SECRETS));}catch{ /* 畫面只顯示設定需求，不輸出錯誤中的敏感值。 */ }
 return <><PageHeader crumbs={[{label:t('webhooks.title')}]} title={t('webhooks.title')} description={t('webhooks.description')}/><Card><CardContent><WebhookManager endpoints={endpoints} products={products} secretNames={secretNames}/></CardContent></Card></>;
}
