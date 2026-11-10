export function currencyDigits(currency:string):number {
 if(!Intl.supportedValuesOf("currency").includes(currency))throw new Error("INVALID_CURRENCY");
 return new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits ?? 2;
}
export function toMinorUnits(amount:string,currency:string):number {
 const digits=currencyDigits(currency);if(!/^\d+(?:\.\d+)?$/.test(amount))throw new Error("INVALID_PRICE");
 const [whole,fraction=""]=amount.split(".");if(fraction.length>digits)throw new Error("INVALID_PRICE");
 const value=BigInt(whole)*10n**BigInt(digits)+BigInt(fraction.padEnd(digits,"0")||"0");
 if(value>99999999n)throw new Error("INVALID_PRICE");return Number(value);
}
export function fromMinorUnits(value:number,currency:string):string {
 const digits=currencyDigits(currency);return (value/10**digits).toFixed(digits);
}
