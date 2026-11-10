import {readFileSync,writeFileSync} from 'node:fs';
import {parse,modify,applyEdits} from 'jsonc-parser';

// 部署按鈕可重新命名 Worker；同步自我綁定，避免指向來源範本的名稱。
const file=new URL('../wrangler.jsonc',import.meta.url);
const original=readFileSync(file,'utf8'),errors=[];
const config=parse(original,errors,{allowTrailingComma:true});
if(errors.length||!config||typeof config.name!=='string'||!config.name.trim()){
 throw new Error('wrangler.jsonc 必須是有效 JSONC 且包含 Worker name。');
}
if(!config.d1_databases?.some(binding=>binding.binding==='DB')){
 throw new Error('缺少 DB 綁定；部署與遷移使用此固定綁定名稱。');
}
const index=config.services?.findIndex(binding=>binding.binding==='WORKER_SELF_REFERENCE')??-1;
if(index<0)throw new Error('缺少 WORKER_SELF_REFERENCE 服務綁定。');
const updated=applyEdits(original,modify(original,['services',index,'service'],config.name,{formattingOptions:{insertSpaces:true,tabSize:2}}));
if(updated!==original){writeFileSync(file,updated);console.log('已同步 Worker 自我綁定。');}
else console.log('Worker 自我綁定已一致。');
