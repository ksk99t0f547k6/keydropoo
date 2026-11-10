import {it,expect,vi} from 'vitest';
import {createHmac} from 'node:crypto';
import {externalRewardDispatcher,type ExternalGrant,type ExternalRewardHook} from '../src/lib/server/external-reward-http';
const secret='ab'.repeat(32),endpoint={url:'https://example.com/grants',secretName:'PARTNER'};
const input:ExternalGrant={operationId:crypto.randomUUID(),productId:crypto.randomUUID(),codeId:crypto.randomUUID(),userId:'customer',reward:{plan:'pro',duration:{days:30}}};
const registry={endpoints:{partner:endpoint},hooks:{},secrets:{PARTNER:secret}};
const resolve=async()=>['93.184.216.34'];
it.each([301,302,303,307,308])('外部發放遇到 %s 轉址不能跟隨或視為有效收據',async status=>{
 const cancel=vi.fn();
 const send=vi.fn<typeof fetch>(async(_url,init)=>{
  if(init?.redirect!=='manual')throw new Error('禁止跟隨轉址或使用 Workers 不支援的模式');
  return new Response(new ReadableStream({cancel}),{status,headers:{Location:'https://other.example/grant','Content-Type':'application/json'}});
 });
 await expect(externalRewardDispatcher(registry,{resolve,fetch:send})('partner',input)).rejects.toThrow('EXTERNAL_REWARD_RESPONSE_INVALID');
 expect(send).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();
});
it('外部權益使用固定操作 ID、簽章與版本，只有匹配收據才算成功',async()=>{
 let request:RequestInit|undefined;
 const send=vi.fn<typeof fetch>(async(_url,init)=>{request=init;return Response.json({operationId:input.operationId,status:'applied'});});
 const dispatch=externalRewardDispatcher(registry,{resolve,fetch:send,now:()=>123000});
 expect(await dispatch('partner',input)).toEqual({operationId:input.operationId,status:'applied'});
 const body=request!.body as string,headers=new Headers(request!.headers);
 expect(JSON.parse(body)).toEqual({...input,version:1});expect(headers.get('Idempotency-Key')).toBe(input.operationId);
 expect(headers.get('Keydrop-Signature')).toBe(`t=123,v1=${createHmac('sha256',Buffer.from(secret,'hex')).update(`123.${body}`).digest('hex')}`);
 expect(request).toMatchObject({redirect:'manual',cache:'no-store'});
 await dispatch('partner',input);expect(send.mock.calls[1][1]?.body).toBe(body);expect(send).toHaveBeenCalledTimes(2);
});
it('明確拒絕可回傳，但錯誤 ID、未知狀態、HTTP 錯誤與超大本文不算發放成功',async()=>{
 const rejected=externalRewardDispatcher(registry,{resolve,fetch:async()=>Response.json({operationId:input.operationId,status:'rejected'})});
 expect(await rejected('partner',input)).toEqual({operationId:input.operationId,status:'rejected'});
 for(const response of [Response.json({operationId:crypto.randomUUID(),status:'applied'}),Response.json({operationId:input.operationId,status:'pending'}),Response.json({operationId:input.operationId,status:'applied',private:'secret'}),new Response('private failure',{status:500}),new Response('x'.repeat(4097),{headers:{'Content-Type':'application/json'}})]){
  const send=vi.fn<typeof fetch>(async()=>response);const dispatch=externalRewardDispatcher(registry,{resolve,fetch:send});
  await expect(dispatch('partner',input)).rejects.toThrow('EXTERNAL_REWARD_RESPONSE_INVALID');expect(send).toHaveBeenCalledOnce();
 }
});
it('私人網路、混合解析、未知整合及重複 ID 不送請求',async()=>{
 const send=vi.fn<typeof fetch>();
 for(const addresses of [[],['127.0.0.1'],['93.184.216.34','10.0.0.1']])await expect(externalRewardDispatcher(registry,{fetch:send,resolve:async()=>addresses})('partner',input)).rejects.toThrow('EXTERNAL_REWARD_DESTINATION_BLOCKED');
 await expect(externalRewardDispatcher(registry,{fetch:send})('unknown',input)).rejects.toThrow('EXTERNAL_REWARD_NOT_CONFIGURED');
 await expect(externalRewardDispatcher({...registry,secrets:{}},{fetch:send})('partner',input)).rejects.toThrow('EXTERNAL_REWARD_NOT_CONFIGURED');
 const hook:ExternalRewardHook=async value=>({operationId:value.operationId,status:'applied'});
 await expect(externalRewardDispatcher({...registry,hooks:{partner:hook}},{fetch:send})('partner',input)).rejects.toThrow('EXTERNAL_REWARD_NOT_CONFIGURED');
 expect(send).not.toHaveBeenCalled();
});
it('逾時涵蓋 DNS、本文讀取與程式 hook，晚到 DNS 不觸發請求',async()=>{
 let finish:(ips:string[])=>void=()=>{};const send=vi.fn<typeof fetch>();
 const slowDns=externalRewardDispatcher(registry,{fetch:send,resolve:()=>new Promise(r=>{finish=r;}),timeoutMs:5});
 await expect(slowDns('partner',input)).rejects.toThrow('EXTERNAL_REWARD_TIMEOUT');finish(['93.184.216.34']);await Promise.resolve();expect(send).not.toHaveBeenCalled();
 // 先確定已進入本文讀取，再推進期限；避免 CI 的 HMAC 計算超過 5ms，誤測成送出前逾時。
 vi.useFakeTimers();
 try{
  let reading!:()=>void;const bodyStarted=new Promise<void>(resolve=>{reading=resolve;});
  const cancel=vi.fn();const response=new Response(new ReadableStream({pull(){reading();},cancel},{highWaterMark:0}),{headers:{'Content-Type':'application/json'}});
  const pending=externalRewardDispatcher(registry,{resolve,fetch:async()=>response,timeoutMs:5})('partner',input);
  const assertion=expect(pending).rejects.toThrow('EXTERNAL_REWARD_TIMEOUT');
  await bodyStarted;expect(cancel).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(5);await assertion;expect(cancel).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
 let signal:AbortSignal|undefined;
 await expect(externalRewardDispatcher({endpoints:{},secrets:{},hooks:{local:async value=>{signal=value.signal;return new Promise(()=>{});}}},{timeoutMs:5})('local',input)).rejects.toThrow('EXTERNAL_REWARD_TIMEOUT');expect(signal?.aborted).toBe(true);
});
it('程式 hook 也驗證收據並隱藏例外內容，過大請求在呼叫前拒絕',async()=>{
 const hook=vi.fn<ExternalRewardHook>(async value=>({operationId:value.operationId,status:'applied'}));
 const dispatch=externalRewardDispatcher({endpoints:{},secrets:{},hooks:{local:hook}});
 expect(await dispatch('local',input)).toMatchObject({status:'applied'});
 await expect(dispatch('local',{...input,reward:{large:'x'.repeat(16384)}})).rejects.toThrow('EXTERNAL_REWARD_REQUEST_TOO_LARGE');expect(hook).toHaveBeenCalledOnce();
 hook.mockRejectedValueOnce(new Error('secret-token-in-provider-error'));
 await expect(dispatch('local',input)).rejects.toThrow(/^EXTERNAL_REWARD_UNAVAILABLE$/);
 hook.mockResolvedValueOnce({operationId:crypto.randomUUID(),status:'applied'});
 await expect(dispatch('local',input)).rejects.toThrow('EXTERNAL_REWARD_RESPONSE_INVALID');
});
