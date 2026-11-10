import {expect,it} from "vitest";
import {conditionFields,evaluateCondition,parseCondition,type ConditionContext} from "../src/lib/domain/conditions";
function context(overrides:Partial<ConditionContext>={}):ConditionContext{
 return {now:1000,answers:{},passphrases:{},invitations:{},purchasedCount:async()=>0,verifyCredential:async()=>false,qualify:async()=>({allowed:false}),...overrides};
}
it("巢狀 AND／OR 正確組合，時間終點不包含在內",async()=>{
 expect(await evaluateCondition({type:"always"},context())).toEqual({allowed:true});
 const rule={type:"and",children:[{type:"time",startsAt:1000,endsAt:2000},{type:"or",children:[{type:"authenticated"},{type:"passphrase",credentialId:"launch"}]}]};
 expect((await evaluateCondition(rule,context())).allowed).toBe(false);
 expect((await evaluateCondition(rule,context({identity:{userId:"user",emailVerified:false}}))).allowed).toBe(true);
 expect((await evaluateCondition(rule,context({passphrases:{launch:"secret"},verifyCredential:async(id,value,kind)=>id==="launch"&&value==="secret"&&kind==="passphrase"}))).allowed).toBe(true);
 expect((await evaluateCondition(rule,context({now:2000,identity:{userId:"user",emailVerified:true}}))).allowed).toBe(false);
});
it("信箱與網域要求已驗證，禁止子網域混淆；購買紀錄要求可信登入",async()=>{
 const rule={type:"email_domain",domains:["example.com"]};
 for(const identity of [{email:"a@example.com",emailVerified:false},{email:"a@evil-example.com",emailVerified:true},{email:"a@x.example.com",emailVerified:true}])expect((await evaluateCondition(rule,context({identity}))).allowed).toBe(false);
 expect((await evaluateCondition(rule,context({identity:{email:"A@EXAMPLE.COM",emailVerified:true}}))).allowed).toBe(true);
 const purchase={type:"purchase",productId:crypto.randomUUID(),minimum:2};
 expect((await evaluateCondition(purchase,context({purchasedCount:async()=>10}))).allowed).toBe(false);
 expect((await evaluateCondition(purchase,context({identity:{userId:"u",emailVerified:false},purchasedCount:async()=>2}))).allowed).toBe(true);
});
it("問卷檢查型別、合法選項、去重與標準答案；公開欄位不包含答案或信箱名單",async()=>{
 const question={type:"question",id:"quiz",label:"Choose",kind:"multiple",required:true,options:["A","B","C"],correct:["A","B"]};
 for(const value of [undefined,"A",["A","A"],["A","B","C"],["A","unknown"]])expect((await evaluateCondition(question,context({answers:{quiz:value}}))).allowed).toBe(false);
 expect((await evaluateCondition(question,context({answers:{quiz:["B","A"]}}))).allowed).toBe(true);
 const fields=conditionFields({type:"and",children:[question,{type:"email",addresses:["private@example.com"]}]});
 expect(fields.questions).toHaveLength(1);expect(fields.questions[0]).not.toHaveProperty("correct");expect(JSON.stringify(fields)).not.toContain("private@example.com");
 const optional={...question,required:false,correct:undefined};
 expect((await evaluateCondition(optional,context())).allowed).toBe(true);
});
it("複雜度、空群組、重複題號與無效題目在執行前拒絕",()=>{
 let deep:unknown={type:"authenticated"};for(let i=0;i<9;i++)deep={type:"and",children:[deep]};
 expect(()=>parseCondition(deep)).toThrow("CONDITION_TOO_COMPLEX");
 expect(()=>parseCondition({type:"or",children:[]})).toThrow();
 expect(()=>parseCondition({type:"time",startsAt:10,endsAt:9})).toThrow();
 const q={type:"question",id:"q",label:"Q",kind:"single",required:true,options:["a","b"]};
 expect(()=>parseCondition({type:"or",children:[q,q]})).toThrow("DUPLICATE_QUESTION");
 expect(()=>parseCondition({...q,correct:"c"})).toThrow();
 expect(()=>parseCondition({...q,options:["a","a"]})).toThrow();
});
it("外部資格失敗或逾時不放行且可重試；完成時取消訊號",async()=>{
 const rule={type:"external",hookId:"eligibility"};
 expect(await evaluateCondition(rule,context({qualify:async()=>{throw new Error("upstream");}}))).toEqual({allowed:false,reason:"QUALIFICATION_UNAVAILABLE",retryable:true});
 let signal:AbortSignal|undefined;
 const result=await evaluateCondition(rule,context({timeoutMs:10,qualify:async(_,s)=>{signal=s;return new Promise(()=>{});}}));
 expect(result).toEqual({allowed:false,reason:"QUALIFICATION_UNAVAILABLE",retryable:true});expect(signal?.aborted).toBe(true);
 expect(await evaluateCondition(rule,context({qualify:async()=>({allowed:true})}))).toEqual({allowed:true});
});
