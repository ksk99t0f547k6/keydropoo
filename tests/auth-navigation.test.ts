import {expect,it} from "vitest";
import {safeReturnTo,returnFromHash,signInLink} from "../src/lib/domain/auth-navigation";
it("登入返回只接受已知站內路徑，私密 token 維持在 fragment",()=>{
 expect(safeReturnTo("/orders/93733092-c073-4070-a578-f932c19a751a")).toBe("/orders/93733092-c073-4070-a578-f932c19a751a");
 expect(safeReturnTo("/orders/93733092-c073-4070-a578-f932c19a751a#token=secret")).toBe("/dashboard");
 const destination=`/claim/launch-2026#token=${"a".repeat(64)}`;
 const link=signInLink(destination);expect(link.split("#")[0]).toBe("/sign-in");
 expect(returnFromHash(link.slice(link.indexOf("#")))).toBe(destination);
 expect(safeReturnTo("/buy/launch-2026")).toBe("/buy/launch-2026");
 expect(safeReturnTo("/claim/free")).toBe("/claim/free");
 expect(returnFromHash(signInLink('/account/security').split('#')[1])).toBe('/account/security');
 expect(returnFromHash(signInLink('/dashboard/security').split('#')[1])).toBe('/dashboard/security');
 expect(safeReturnTo('/account/security#token=anything')).toBe('/dashboard');
 for(const value of [undefined,"https://evil.test","//evil.test","/\\evil.test","/claim/x?redirect=evil","/claim/x#token=bad","/api/auth/sign-out","/claim/%2e%2e/evil","/claim/x\n","javascript:alert(1)"])expect(safeReturnTo(value)).toBe("/dashboard");
});
