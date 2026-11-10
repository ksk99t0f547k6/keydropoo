import {expect,it,vi} from 'vitest';
import {checkHttpEligibility} from '../src/lib/server/eligibility-http';
import {externalRewardDispatcher} from '../src/lib/server/external-reward-http';
import {webhookHttpSender} from '../src/lib/server/webhook-http';

it('出站 HTTP 保留 Workers 原生 fetch 所需的全域接收者',async()=>{
 const operationId=crypto.randomUUID(),productId=crypto.randomUUID();
 // Node 的 fetch 與箭頭 mock 不檢查 this，會漏掉 Workers 排程的 Illegal invocation。
 const transport=vi.fn<typeof fetch>(async function(this:unknown,url){
  if(this!==globalThis)throw new TypeError('Illegal invocation');
  const path=new URL(String(url)).pathname;
  return Response.json(path==='/eligibility'?{allowed:true}:path==='/reward'?{operationId,status:'applied'}:{accepted:true});
 });
 const dependencies={fetch:transport,resolve:async()=>['93.184.216.34']};
 expect(await checkHttpEligibility({url:'https://example.com/eligibility'},
  {campaignId:crypto.randomUUID(),productId,actor:{emailVerified:false},signal:new AbortController().signal},{},dependencies)).toEqual({allowed:true});
 const secret='ab'.repeat(32);
 expect(await externalRewardDispatcher({endpoints:{partner:{url:'https://example.com/reward',secretName:'PARTNER'}},hooks:{},secrets:{PARTNER:secret}},dependencies)
  ('partner',{operationId,productId,codeId:crypto.randomUUID(),userId:'qa-user',reward:{plan:'pro'}})).toEqual({operationId,status:'applied'});
 expect(await webhookHttpSender({PARTNER:secret},dependencies)
  ({id:'endpoint',url:'https://example.com/events',secretName:'PARTNER'},
   {id:'qa-event',type:'code.claimed',productId,createdAt:1000,data:{claimId:'qa-claim'}})).toBe(200);
 expect(transport).toHaveBeenCalledTimes(3);
});
