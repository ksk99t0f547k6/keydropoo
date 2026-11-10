import {expect,it,vi} from "vitest";
import {createHmac} from "node:crypto";
import {webhookSignature,webhookSecrets,webhookHttpSender} from "../src/lib/server/webhook-http";
const secret="ab".repeat(32),target={id:"endpoint",url:"https://example.com/events",secretName:"PARTNER"};
const event={id:"claim:fixture",type:"code.claimed",productId:"product",createdAt:1000,data:{claimId:"fixture"}};
it.each([301,302,303,307,308])('事件 %s 轉址保留失敗狀態且不向新目的地轉送簽章',async status=>{
 const send=vi.fn<typeof fetch>(async(_url,init)=>{
  if(init?.redirect!=='manual')throw new Error('禁止轉送簽章');
  return new Response(null,{status,headers:{Location:'https://other.example/events'}});
 });
 expect(await webhookHttpSender({PARTNER:secret},{resolve:async()=>['93.184.216.34'],fetch:send})(target,event)).toBe(status);
 expect(send).toHaveBeenCalledOnce();
});
it("HMAC 與獨立實作相符，涵蓋時間戳與原始 JSON 本文",async()=>{
 const body=JSON.stringify({...event,version:1});
 const expected=createHmac('sha256',Buffer.from(secret,'hex')).update(`123.${body}`).digest('hex');
 expect(await webhookSignature(secret,123,body)).toBe(`t=123,v1=${expected}`);
 expect(await webhookSignature(secret,124,body)).not.toContain(expected);
 expect(await webhookSignature(secret,123,body+' ')).not.toContain(expected);
 expect(()=>webhookSecrets('{"PARTNER":"short"}')).toThrow();
});
it("HTTP 通知簽章、事件 ID、禁止轉址且不讀取回應本文",async()=>{
 const cancel=vi.fn();let received:RequestInit|undefined;
 const sender=webhookHttpSender({PARTNER:secret},{resolve:async()=>['93.184.216.34'],now:()=>123000,fetch:async(_url,init)=>{
  received=init;return new Response(new ReadableStream({cancel}),{status:200});
 }});
 expect(await sender(target,event)).toBe(200);
 const headers=new Headers(received?.headers),body=received?.body as string;
 expect(headers.get('Keydrop-Event-Id')).toBe(event.id);
 expect(headers.get('Keydrop-Signature')).toBe(await webhookSignature(secret,123,body));
 expect(JSON.parse(body)).toEqual({...event,version:1});expect(received?.redirect).toBe('manual');expect(cancel).toHaveBeenCalledOnce();
});
it("拒絕內網、混合 DNS、無密鑰及危險 URL，不送出請求",async()=>{
 const send=vi.fn<typeof fetch>();
 for(const addresses of [[],['127.0.0.1'],['93.184.216.34','10.0.0.1']]){
  await expect(webhookHttpSender({PARTNER:secret},{resolve:async()=>addresses,fetch:send})(target,event)).rejects.toThrow('WEBHOOK_DESTINATION_BLOCKED');
 }
 await expect(webhookHttpSender({}, {fetch:send})(target,event)).rejects.toThrow('WEBHOOK_SECRET_MISSING');
 await expect(webhookHttpSender({PARTNER:secret},{fetch:send})({...target,url:'http://example.com/events'},event)).rejects.toThrow();
 expect(send).not.toHaveBeenCalled();
});
it("DNS 或 HTTP 逾時會中止，晚回覆 DNS 不再發送",async()=>{
 const send=vi.fn<typeof fetch>();let finish:(value:string[])=>void=()=>{};
 const sender=webhookHttpSender({PARTNER:secret},{timeoutMs:5,fetch:send,resolve:()=>new Promise(resolve=>{finish=resolve;})});
 await expect(sender(target,event)).rejects.toThrow('WEBHOOK_TIMEOUT');finish(['93.184.216.34']);await Promise.resolve();
 expect(send).not.toHaveBeenCalled();
 let signal:AbortSignal|undefined;
 const stalled=webhookHttpSender({PARTNER:secret},{timeoutMs:5,resolve:async()=>['93.184.216.34'],fetch:async(_url,init)=>{signal=init?.signal??undefined;return new Promise(()=>{});}});
 await expect(stalled(target,event)).rejects.toThrow('WEBHOOK_TIMEOUT');expect(signal?.aborted).toBe(true);
});
