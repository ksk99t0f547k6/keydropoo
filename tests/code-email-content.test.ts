import {it,expect} from 'vitest';
import {codeEmailText} from '../src/lib/server/code-email-content';

it('停用我的碼時不提供失效入口，無效網站設定不加入郵件連結',()=>{
 const input={product:'Product {url}',code:'CODE-{product}',appUrl:'https://keydrop.example',linkRecipient:true};
 const text=codeEmailText(input,false);
 expect(text).toContain('https://keydrop.example/');
 expect(text).not.toContain('/my-codes');
 expect(text).not.toContain('Find my emailed codes');
 expect(text).toContain('Product {url}:\n\nCODE-{product}');
 for(const appUrl of ['javascript:alert(1)','https://user:secret@keydrop.example','https://keydrop.example/?code=secret','http://keydrop.example','invalid']){
  expect(codeEmailText({...input,appUrl})).not.toContain('Visit');
  expect(codeEmailText({...input,appUrl})).not.toContain('Find my emailed codes');
  expect(codeEmailText({...input,appUrl})).not.toContain(appUrl);
 }
});
