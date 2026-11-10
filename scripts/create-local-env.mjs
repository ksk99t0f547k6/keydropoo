import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const [destination,email,origin='http://localhost:3000']=process.argv.slice(2);
const project=resolve(fileURLToPath(new URL('..',import.meta.url)));
if(!destination||!isAbsolute(destination)||!email||!/^\S+@\S+\.\S+$/.test(email)||/[\r\n"\\]/.test(email)){
 throw new Error('用法：node scripts/create-local-env.mjs /絕對路徑/keys/keydrop/local.env 管理員Email [http://localhost:3000]');
}
const path=relative(project,resolve(destination));
if(path===''||(!path.startsWith('../')&&!isAbsolute(path)))throw new Error('密鑰檔必須放在專案目錄之外。');
const url=new URL(origin);
if(url.origin!==origin||url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('本機 origin 必須是 http://localhost 或 http://127.0.0.1，可附連接埠，不加尾斜線。');
mkdirSync(dirname(destination),{recursive:true,mode:0o700});
const contents=[`APP_URL=${origin}`,`ADMIN_EMAIL=${JSON.stringify(email.toLowerCase())}`,...['BETTER_AUTH_SECRET','SETUP_SECRET','CODE_ENCRYPTION_KEY'].map(key=>`${key}=${randomBytes(32).toString('hex')}`)].join('\n')+'\n';
// 不覆寫既有密鑰，避免讓既有碼與登入資料失效；也不將內容印到終端機。
writeFileSync(destination,contents,{flag:'wx',mode:0o600});
console.log('本機設定已建立。使用 KEYDROP_DEV_ENV_FILE 指向此檔案，再啟動開發伺服器。');
