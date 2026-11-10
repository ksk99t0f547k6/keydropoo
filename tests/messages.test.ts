import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {parse,TYPE,type MessageFormatElement} from "@formatjs/icu-messageformat-parser";
import {locales,matchLocale} from "../src/i18n/locales";

type Tree={[key:string]:string|Tree};
const load=(locale:string)=>JSON.parse(readFileSync(new URL(`../messages/${locale}.json`,import.meta.url),"utf8")) as Tree;
function flatten(tree:Tree,prefix=""):Record<string,string>{
 return Object.fromEntries(Object.entries(tree).flatMap(([key,value])=>typeof value==="string"?[[prefix+key,value]]:Object.entries(flatten(value,`${prefix}${key}.`))));
}
// 收集訊息用到的參數名稱與型別，翻譯必須和英文一致。
function args(elements:MessageFormatElement[],out=new Set<string>()){
 for(const el of elements){
  if(el.type===TYPE.argument||el.type===TYPE.number||el.type===TYPE.date||el.type===TYPE.time)out.add(`${el.value}:${el.type}`);
  if(el.type===TYPE.plural||el.type===TYPE.select){out.add(`${el.value}:${el.type}`);for(const option of Object.values(el.options))args(option.value,out);}
  if(el.type===TYPE.tag){out.add(`<${el.value}>`);args(el.children,out);}
 }
 return out;
}
const english=flatten(load("en"));

describe.each(locales.filter(l=>l!=="en"))("翻譯 %s",locale=>{
 const messages=flatten(load(locale));
 it("鍵與英文版完全相同",()=>{
  expect(Object.keys(messages).filter(k=>!(k in english))).toEqual([]);
  expect(Object.keys(english).filter(k=>!(k in messages))).toEqual([]);
 });
 it("每則訊息都是合法 ICU 格式，參數與英文一致，且不是空字串",()=>{
  const problems:string[]=[];
  for(const [key,source] of Object.entries(english)){
   const target=messages[key];if(typeof target!=="string")continue;
   if(!target.trim()&&source.trim()){problems.push(`${key}: empty`);continue;}
   try{
    const a=[...args(parse(source))].sort().join(","),b=[...args(parse(target))].sort().join(",");
    if(a!==b)problems.push(`${key}: ${a} != ${b}`);
   }catch(error){problems.push(`${key}: ${(error as Error).message}`);}
  }
  expect(problems).toEqual([]);
 });
});

it("Accept-Language 對應到最接近的支援語言",()=>{
 expect(matchLocale("zh-TW,zh;q=0.9")).toBe("zh-Hant");
 expect(matchLocale("zh-HK")).toBe("zh-Hant");
 expect(matchLocale("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh-Hans");
 expect(matchLocale("zh")).toBe("zh-Hans");
 expect(matchLocale("ja-JP,ja;q=0.9")).toBe("ja");
 expect(matchLocale("fr-FR,de;q=0.8")).toBe("de");
 expect(matchLocale("ar-SA")).toBe("ar");
 expect(matchLocale("fr")).toBe("en");
 expect(matchLocale(null)).toBe("en");
});

it("loadMessages 對未知語言回英文，對已知語言補齊缺鍵",async()=>{
 const {loadMessages}=await import("../src/i18n/messages");
 const en=load("en") as unknown as {common:{brand:string;signIn:string}};
 expect((await loadMessages("xx")).common.signIn).toBe(en.common.signIn);
 expect((await loadMessages(null)).common.signIn).toBe(en.common.signIn);
 const ja=await loadMessages("ja");
 expect(ja.common.signIn).toBe((load("ja") as unknown as {common:{signIn:string}}).common.signIn);
});
