import type {EligibilityContext,EligibilityEndpoint} from "@/lib/server/eligibility-http";
export type EligibilityHook=(context:EligibilityContext)=>Promise<{allowed:boolean}>;
// 部署者只註冊自己控制的 HTTPS 網域；活動設定只選 ID，不能提交任意 URL。
export const eligibilityEndpoints:Readonly<Record<string,EligibilityEndpoint>>={};
// hook 與 HTTP 端點 ID 不可重複。未知 ID 會拒絕並提示稍後重試。
export const eligibilityHooks:Readonly<Record<string,EligibilityHook>>={};
