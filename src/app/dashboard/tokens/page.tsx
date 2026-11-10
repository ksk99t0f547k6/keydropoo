import {headers} from "next/headers";
import {redirect} from "next/navigation";
import {getTranslations} from "next-intl/server";
import {runtime} from "@/lib/server/env";
import {createAuth,isAdmin} from "@/lib/server/auth";
import {listApiTokens} from "@/lib/server/api-tokens";
import {TokenManager} from "@/components/tokens/token-manager";
import {PageHeader} from '@/components/dashboard/page-header';
import {Card,CardContent} from '@/components/motion/card';

export const dynamic="force-dynamic";
export default async function Tokens(){
 const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect("/sign-in");if(!await isAdmin(env.DB,session.user.id))redirect("/");
 const t=await getTranslations();
 const [tokens,{results:products}]=await Promise.all([listApiTokens(env.DB),env.DB.prepare("SELECT id,name FROM products ORDER BY name,id").all<{id:string;name:string}>()]);
 // eslint-disable-next-line react-hooks/purity -- 此動態伺服器頁面的請求時間快照；實際有效性仍由 API 判定。
 const now=Date.now();
 return <><PageHeader crumbs={[{label:t("tokens.title")}]} title={t("tokens.title")} description={t("tokens.description")}/><Card><CardContent><TokenManager tokens={tokens} products={products} now={now}/></CardContent></Card></>;
}
