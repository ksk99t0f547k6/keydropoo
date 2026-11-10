import {it,expect} from 'vitest';
import {discountFormInput,discountOperationKey,forgetDiscountOperation,emptyDiscountFields} from '../src/lib/domain/stripe-discount-form';
import {stripeCouponCreate,stripePromotionCreate} from '../src/lib/server/stripe-discounts';
it('表單產生符合建立協定的折扣，保留貨幣最小單位與訂閱月份',()=>{
 const fields={...emptyDiscountFields,discountKind:'amount',amount:'500',currency:'USD',currencyOptions:'EUR=450,JPY=800',duration:'repeating',months:'3',products:'prod_a, prod_b',maxRedemptions:'20',expires:'2030-01-01T12:00:00Z'};
 const result=stripeCouponCreate.parse(discountFormInput('coupon',fields));
 expect(result).toMatchObject({discount:{kind:'amount',amountOff:500,currency:'usd',currencyOptions:{eur:450,jpy:800}},duration:'repeating',durationInMonths:3,productIds:['prod_a','prod_b'],maxRedemptions:20,redeemBy:1893499200});
 expect(stripeCouponCreate.parse(discountFormInput('coupon',{...emptyDiscountFields,percent:'25.5'}))).toMatchObject({discount:{kind:'percent',percentOff:25.5}});
});
it('促銷碼保留零最低消費、指定客戶、期限及次數，空白欄位不新增限制',()=>{
 const result=stripePromotionCreate.parse(discountFormInput('promotion_code',{...emptyDiscountFields,couponId:'coupon_a',code:'SAVE-25',minimum:'0',minimumCurrency:'USD',customerId:'cus_a',firstTime:true,active:false}));
 expect(result).toMatchObject({couponId:'coupon_a',code:'SAVE-25',minimumAmount:0,minimumAmountCurrency:'usd',customerId:'cus_a',firstTimeTransaction:true,active:false});
 expect(result.maxRedemptions).toBeUndefined();expect(result.expiresAt).toBeUndefined();
});
it('無效或模糊金額、重複貨幣與無效日期在送出前拒絕',()=>{
 for(const patch of [{discountKind:'amount',amount:'1.5'},{discountKind:'amount',amount:'500',currencyOptions:'USD=1,usd=2'},{percent:'NaN'},{percent:'101'},{expires:'invalid'},{maxRedemptions:'0'},{duration:'repeating',months:''}]){
  expect(()=>discountFormInput('coupon',{...emptyDiscountFields,...patch})).toThrow('INVALID_INPUT');
 }
});
it('重新建立表單仍沿用工作階段中的同請求 UUID；範圍與內容不同則分開且不儲存原始碼',async()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,removeItem:(key:string)=>{values.delete(key);},setItem:(key:string,value:string)=>{values.set(key,value);}};
 const request={action:'createPromotion',expectedScope:{accountId:'acct_a',livemode:false},input:{couponId:'coupon_a',code:'PRIVATE-CODE'}};
 const a=await discountOperationKey(storage,request);
 expect(await discountOperationKey(storage,{input:{code:'PRIVATE-CODE',couponId:'coupon_a'},expectedScope:{livemode:false,accountId:'acct_a'},action:'createPromotion'})).toBe(a);
 expect(await discountOperationKey(storage,{...request,expectedScope:{...request.expectedScope,livemode:true}})).not.toBe(a);
 expect(await discountOperationKey(storage,{...request,input:{...request.input,code:'OTHER'}})).not.toBe(a);
 expect(JSON.stringify([...values])).not.toContain('PRIVATE-CODE');
 await forgetDiscountOperation(storage,request);expect(await discountOperationKey(storage,request)).not.toBe(a);
});
