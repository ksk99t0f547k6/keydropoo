export interface DiscountFields {
 name:string;discountKind:string;percent:string;amount:string;currency:string;currencyOptions:string;duration:string;months:string;products:string;
 couponId:string;code:string;customerId:string;customerAccount:string;minimum:string;minimumCurrency:string;maxRedemptions:string;expires:string;
 firstTime:boolean;active:boolean;
}
export const emptyDiscountFields:DiscountFields={name:'',discountKind:'percent',percent:'25',amount:'',currency:'usd',currencyOptions:'',duration:'once',months:'',products:'',couponId:'',code:'',customerId:'',customerAccount:'',minimum:'',minimumCurrency:'usd',maxRedemptions:'',expires:'',firstTime:false,active:true};
function integer(value:string,min=1){if(!/^\d+$/.test(value))throw new Error('INVALID_INPUT');const n=Number(value);if(!Number.isSafeInteger(n)||n<min)throw new Error('INVALID_INPUT');return n;}
function currency(value:string){const result=value.trim().toLowerCase();if(!/^[a-z]{3}$/.test(result))throw new Error('INVALID_INPUT');return result;}
export function discountFormInput(kind:'coupon'|'promotion_code',fields:DiscountFields){
 const expires=fields.expires?Date.parse(fields.expires):undefined;if(expires!==undefined&&(!Number.isFinite(expires)||expires<=0))throw new Error('INVALID_INPUT');
 const common={maxRedemptions:fields.maxRedemptions?integer(fields.maxRedemptions):undefined};
 if(kind==='promotion_code')return {...common,couponId:fields.couponId.trim(),code:fields.code.trim(),active:fields.active,customerId:fields.customerId.trim()||undefined,customerAccount:fields.customerAccount.trim()||undefined,expiresAt:expires===undefined?undefined:Math.floor(expires/1000),firstTimeTransaction:fields.firstTime,minimumAmount:fields.minimum?integer(fields.minimum,0):undefined,minimumAmountCurrency:fields.minimum?currency(fields.minimumCurrency):undefined};
 const percent=Number(fields.percent);if(fields.discountKind==='percent'&&(!fields.percent.trim()||!Number.isFinite(percent)||percent<=0||percent>100))throw new Error('INVALID_INPUT');
 const options:Record<string,number>={};
 if(fields.discountKind==='amount'&&fields.currencyOptions.trim())for(const pair of fields.currencyOptions.split(',')){
  const parts=pair.trim().split('=');if(parts.length!==2)throw new Error('INVALID_INPUT');const code=currency(parts[0]);if(Object.hasOwn(options,code))throw new Error('INVALID_INPUT');options[code]=integer(parts[1].trim());
 }
 return {...common,name:fields.name.trim()||undefined,duration:fields.duration,durationInMonths:fields.duration==='repeating'?integer(fields.months):undefined,
  redeemBy:expires===undefined?undefined:Math.floor(expires/1000),productIds:fields.products.trim()?fields.products.split(',').map(v=>v.trim()):undefined,
  discount:fields.discountKind==='percent'?{kind:'percent',percentOff:percent}:{kind:'amount',amountOff:integer(fields.amount),currency:currency(fields.currency),currencyOptions:Object.keys(options).length?options:undefined}};
}
function stable(value:unknown):unknown{
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));
 return value;
}
// 僅在目前分頁工作階段儲存請求雜湊與 UUID，不存原始碼或憑證。
async function operationStorageKey(request:unknown){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(request))));
 const hash=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join(''),key=`keydrop:stripe-create:${hash}`;
 return key;
}
export async function forgetDiscountOperation(storage:Pick<Storage,'removeItem'>,request:unknown){storage.removeItem(await operationStorageKey(request));}
export async function discountOperationKey(storage:Pick<Storage,'getItem'|'setItem'>,request:unknown){
 const key=await operationStorageKey(request);
 const existing=storage.getItem(key);if(existing&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(existing))return existing;
 const id=crypto.randomUUID();storage.setItem(key,id);return id;
}
