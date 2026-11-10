import {it,expect} from 'vitest';
import {testDatabase} from './d1';
import {createProduct} from '../src/lib/server/inventory';
import {setSalesBatch} from '../src/lib/server/sales';
it('銷售設定可關聯與清除 Stripe 商品，舊請求省略欄位保留既有設定',async()=>{
 const {db,sqlite}=testDatabase();try{
  const product=await createProduct(db,{name:'Sales',slug:'sales'});
  await setSalesBatch(db,product.id,null,true,'prod_fixture');
  await setSalesBatch(db,product.id,null);
  expect(sqlite.prepare('SELECT allow_promotion_codes,stripe_product_id FROM products').get()).toEqual({allow_promotion_codes:1,stripe_product_id:'prod_fixture'});
  await expect(setSalesBatch(db,product.id,null,true,'bad-id')).rejects.toThrow();
  await setSalesBatch(db,product.id,null,false,null);
  expect(sqlite.prepare('SELECT allow_promotion_codes,stripe_product_id FROM products').get()).toEqual({allow_promotion_codes:0,stripe_product_id:null});
 }finally{sqlite.close();}
});
