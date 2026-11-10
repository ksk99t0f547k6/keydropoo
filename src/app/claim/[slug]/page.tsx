import type {Metadata} from "next";
import {headers} from "next/headers";
import {ClaimPage} from "@/components/claims/claim-page";
import {runtime} from "@/lib/server/env";
import {createAuth} from "@/lib/server/auth";
export const dynamic="force-dynamic";
export const metadata:Metadata={robots:{index:false,follow:false},referrer:"no-referrer"};
export default async function Claim({params}:{params:Promise<{slug:string}>}){
 const {slug}=await params;const {env,settings}=await runtime();
 const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 // 介面只需要登入與驗證狀態，不把 session 憑證或個資傳給用戶端。
 return <ClaimPage slug={slug} viewer={session?{emailVerified:session.user.emailVerified}:null}/>;
}
