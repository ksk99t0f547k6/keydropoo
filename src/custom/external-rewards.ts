import type {ExternalRewardEndpoint,ExternalRewardHook} from '@/lib/server/external-reward-http';
// 部署者註冊自己控制的服務；後台只能選整合 ID，不能提交任意 URL。
export const externalRewardEndpoints:Readonly<Record<string,ExternalRewardEndpoint>>={};
// hook 必須以 operationId 實作持久化冪等，並遵守 signal；與 HTTP 端點 ID 不可重複。
export const externalRewardHooks:Readonly<Record<string,ExternalRewardHook>>={};
