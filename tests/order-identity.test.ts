import {expect,it} from "vitest";
import {orderIdentity} from "../src/lib/server/order-identity";
const secret="test-order-identity-at-least-32-characters";
it("匿名購買登入後保留原瀏覽器查看權，不讓其他瀏覽器冒領",async()=>{
 const anonymous=await orderIdentity(null,undefined,secret,"https://example.test");
 const cookie=anonymous.setCookie!.split(';')[0];
 const again=await orderIdentity(cookie,undefined,secret,"https://example.test");expect(again.buyerKey).toBe(anonymous.buyerKey);expect(again.setCookie).toBeNull();
 const signedIn=await orderIdentity(cookie,"customer",secret,"https://example.test");expect(signedIn.allowedKeys).toContain(anonymous.buyerKey);expect(signedIn.buyerKey).not.toBe(anonymous.buyerKey);
 const other=await orderIdentity(null,"stranger",secret,"https://example.test");expect(other.allowedKeys).not.toContain(anonymous.buyerKey);
 const tampered=await orderIdentity(cookie.replace(/.$/,cookie.endsWith('0')?'1':'0'),undefined,secret,"https://example.test");expect(tampered.buyerKey).not.toBe(anonymous.buyerKey);
});
