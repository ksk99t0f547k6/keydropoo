import english from '../../../messages/en.json';
import type {Messages} from '../../i18n/messages';
import {siteFeatures} from '../../config/site';

// email：收件人語言的郵件文案（預設英文）。
export function codeEmailText(input:{product:string;code:string;appUrl?:string;linkRecipient?:boolean;email?:Messages['email']},showMyCodes:boolean=siteFeatures.myCodes){
 const email=input.email??english.email;
 const body=email.codeBody.replace(/\{(product|code)\}/g,(_match,field)=>field==='product'?input.product:input.code);
 if(!input.appUrl)return body;
 // 只使用部署設定的網站 origin，不把碼、Email 或其他憑證放進連結。
 let origin:string;
 try{
  const url=new URL(input.appUrl);
  if(url.origin!==input.appUrl||!(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname))))return body;
  origin=url.origin;
 }catch{return body;}
 const template=showMyCodes?(input.linkRecipient?email.linkRecipient:email.viewCodes):email.visitWebsite;
 return body+'\n\n'+template.replace('{url}',origin+(showMyCodes?'/my-codes':'/'));
}
