import { expect,it } from "vitest";
import { testDatabase } from "./d1";
import { archiveProduct,createBatch,createProduct,listProducts,updateProduct } from "../src/lib/server/inventory";
import { fromMinorUnits,toMinorUnits } from "../src/lib/domain/money";

it("價格精確轉換並拒絕額外小數、負數與未知貨幣",()=>{
 expect(toMinorUnits("19.99","USD")).toBe(1999);
 expect(toMinorUnits("123","JPY")).toBe(123);
 expect(toMinorUnits("1.234","KWD")).toBe(1234);
 expect(fromMinorUnits(1999,"USD")).toBe("19.99");
 for(const [amount,currency] of [["1.001","USD"],["1.1","JPY"],["-1","USD"],["1e3","USD"],["1000000","USD"],["1","ZZZ"]]) expect(()=>toMinorUnits(amount,currency)).toThrow();
});

it("商品修改保留庫存，封存阻止入庫並可恢復；列表分頁及字面搜尋",async()=>{
 const {db,sqlite}=testDatabase();
 try {
  const product=await createProduct(db,{name:"100%_ Product",slug:"target"});
  const key="ab".repeat(32);
  const input={productId:product.id,name:"Stock",kind:"external",source:"manual",codes:["00001"]};
  await createBatch(db,key,input);
  await updateProduct(db,product.id,{name:"100%_ Product",slug:"target",currency:"JPY",priceMinor:500,shortagePolicy:"backorder",revokeOnRefund:false});
  const updated=(await listProducts(db,{query:"%_"})).products[0];
  expect(updated.price_minor).toBe(500);expect(updated.currency).toBe("JPY");
  expect(updated.shortage_policy).toBe("backorder");expect(updated.revoke_on_refund).toBe(0);expect(updated.code_count).toBe(1);
  await archiveProduct(db,product.id,true);
  expect((await listProducts(db,{})).total).toBe(0);
  expect((await listProducts(db,{state:"archived"})).total).toBe(1);
  await expect(createBatch(db,key,{...input,codes:["00002"]})).rejects.toThrow("PRODUCT_NOT_FOUND");
  await archiveProduct(db,product.id,false);
  await createBatch(db,key,{...input,codes:["00002"]});
  for(let i=0;i<21;i++)await createProduct(db,{name:`Product ${i}`,slug:`product-${i}`});
  const first=await listProducts(db,{});const second=await listProducts(db,{page:2});
  expect(first.total).toBe(22);expect(first.products).toHaveLength(20);expect(second.products).toHaveLength(2);
  expect(first.products.some(a=>second.products.some(b=>a.id===b.id))).toBe(false);
  expect((await listProducts(db,{query:"%_"})).total).toBe(1);
  await expect(updateProduct(db,product.id,{name:"Duplicate",slug:"product-0"})).rejects.toThrow();
  await expect(archiveProduct(db,crypto.randomUUID(),true)).rejects.toThrow("PRODUCT_NOT_FOUND");
 }finally{sqlite.close();}
});
