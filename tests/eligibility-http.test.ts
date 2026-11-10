import {expect,it,vi} from "vitest";
import {checkHttpEligibility,endpointUrl,isPublicAddress,eligibilitySecrets} from "../src/lib/server/eligibility-http";
const context=()=>({campaignId:crypto.randomUUID(),productId:crypto.randomUUID(),actor:{userId:"user-a",email:"private@example.com",emailVerified:true},signal:new AbortController().signal});
const endpoint={url:"https://api.example.com/eligibility",secretName:"PARTNER"};
const resolve=async()=>["93.184.216.34"];
it("目的地限制 HTTPS／標準埠／DNS 網域，拒絕字面 IP 與內部名稱",()=>{
 for(const url of ["http://api.example.com","https://127.0.0.1","https://[::1]","https://2130706433","https://localhost","https://service.internal","https://api.example.com:8443","https://user:pass@api.example.com","https://api.example.com?secret=value","https://api.example.com#fragment"])expect(()=>endpointUrl(url)).toThrow();
 expect(endpointUrl(endpoint.url).hostname).toBe("api.example.com");
 for(const address of ["127.0.0.1","10.0.0.1","172.16.0.1","192.168.0.1","100.64.0.1","169.254.169.254","198.18.0.1","224.0.0.1","::1","::ffff:127.0.0.1","fe80::1","fc00::1","2001::1","2001:db8::1","2002:a00:1::1","3fff::1"])expect(isPublicAddress(address)).toBe(false);
 expect(isPublicAddress("1.1.1.1")).toBe(true);expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
});
it("DNS 任一位址非公開便拒絕，且不發送請求或憑證",async()=>{
 const fetcher=vi.fn<typeof fetch>();
 await expect(checkHttpEligibility(endpoint,context(),{PARTNER:"secret"},{resolve:async()=>["93.184.216.34","127.0.0.1"],fetch:fetcher})).rejects.toThrow("ELIGIBILITY_DESTINATION_BLOCKED");
 expect(fetcher).not.toHaveBeenCalled();
});
it("傳送活動及最少身分，Email 必須明確啟用且經驗證",async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({allowed:true,reason:"internal detail"}));
 const ctx=context();
 expect(await checkHttpEligibility(endpoint,ctx,{PARTNER:"secret"},{resolve,fetch:fetcher})).toEqual({allowed:true});
 const request=fetcher.mock.calls[0][1]!;expect(request.redirect).toBe("manual");expect(request.signal).toBe(ctx.signal);
 expect(new Headers(request.headers).get("Authorization")).toBe("Bearer secret");
 const body=JSON.parse(request.body as string);expect(body.campaignId).toBe(ctx.campaignId);expect(body.identity).toEqual({userId:"user-a",emailVerified:true});
 fetcher.mockResolvedValueOnce(Response.json({allowed:false}));
 await checkHttpEligibility({...endpoint,shareEmail:true},ctx,{PARTNER:"secret"},{resolve,fetch:fetcher});
 expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string).identity.email).toBe(ctx.actor.email);
 fetcher.mockResolvedValueOnce(Response.json({allowed:false}));
 await checkHttpEligibility({...endpoint,shareEmail:true},{...ctx,actor:{...ctx.actor,emailVerified:false}},{PARTNER:"secret"},{resolve,fetch:fetcher});
 expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string).identity).not.toHaveProperty("email");
});
it("異常／重新導向／超大／錯誤 JSON 回應不能視為允許",async()=>{
 for(const response of [new Response("",{status:302}),new Response("error",{status:500}),new Response("true",{headers:{"content-type":"text/plain"}}),Response.json({allowed:"true"}),Response.json({allowed:true,reason:"x".repeat(17000)}),new Response("{",{headers:{"content-type":"application/json"}})]){
  await expect(checkHttpEligibility(endpoint,context(),{PARTNER:"secret"},{resolve,fetch:async()=>response})).rejects.toThrow();
 }
});
it("缺少密鑰與取消後不發請求，整合密鑰 JSON 嚴格解析",async()=>{
 const fetcher=vi.fn<typeof fetch>();
 await expect(checkHttpEligibility(endpoint,context(),{},{resolve,fetch:fetcher})).rejects.toThrow("ELIGIBILITY_SECRET_MISSING");
 const controller=new AbortController();controller.abort();
 await expect(checkHttpEligibility(endpoint,{...context(),signal:controller.signal},{PARTNER:"secret"},{resolve,fetch:fetcher})).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
 expect(eligibilitySecrets('{"PARTNER":"secret"}')).toEqual({PARTNER:"secret"});
 expect(()=>eligibilitySecrets('{"PARTNER":12}')).toThrow();
});
