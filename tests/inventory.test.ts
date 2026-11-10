import { expect, it } from "vitest";
import { generateCodes, encryptionKey, sealCode, openCode } from "../src/lib/domain/codes";
import { createProduct, createBatch } from "../src/lib/server/inventory";
import { testDatabase } from "./d1";
const testKey = "01".repeat(32);
it("產生一千個格式正確且不重複的碼", () => {
 const codes = generateCodes({ count: 1000, prefix: "TEST-" });
 expect(new Set(codes).size).toBe(1000);
 expect(codes.every((c) => /^TEST-(?:[A-HJ-NP-Z2-9]{5}-){3}[A-HJ-NP-Z2-9]{5}$/.test(c))).toBe(true);
 expect(() => generateCodes({ alphabet: "01", length: 12 })).toThrow();
 expect(() => generateCodes({ alphabet: "AABC" })).toThrow();
});
it("加密保留原始碼及前導零，驗證上下文與竄改", async () => {
 const key = await encryptionKey(testKey);
 const value = await sealCode("0000123-AbC",key,"product:row");
 expect(value).not.toContain("0000123-AbC");
 expect(await openCode(value,key,"product:row")).toBe("0000123-AbC");
 await expect(openCode(value,key,"other:row")).rejects.toThrow();
 await expect(openCode(value+"00",key,"product:row")).rejects.toThrow();
});
it("一千碼批次入庫、重複碼整批回滾，密文不洩漏原文", async () => {
 const { db, sqlite } = testDatabase();
 const product = await createProduct(db,{ name: "Example", slug: "example" });
 const codes = generateCodes({ count: 1000 });
 const input = { productId: product.id, name: "Launch", kind: "license", source: "generated", codes };
 expect((await createBatch(db,testKey,input)).count).toBe(1000);
 expect(sqlite.prepare("SELECT count(*) AS n FROM codes").get()?.n).toBe(1000);
 await expect(createBatch(db,testKey,{ ...input, codes: ["new-code",codes[0]] })).rejects.toThrow();
 expect(sqlite.prepare("SELECT count(*) AS n FROM code_batches").get()?.n).toBe(1);
 expect(sqlite.prepare("SELECT count(*) AS n FROM codes").get()?.n).toBe(1000);
 const row = sqlite.prepare("SELECT * FROM codes LIMIT 1").get()!;
 expect(codes).toContain(await openCode(row.ciphertext as string,await encryptionKey(testKey),`${product.id}:${row.id}`));
 sqlite.close();
});
it("匯入拒絕前後空白、批次重複與不存在的產品", async () => {
 const { db, sqlite } = testDatabase();
 const product = await createProduct(db,{ name: "Example", slug: "example" });
 const input = { productId: product.id, name: "Import", kind: "external", source: "import" };
 await expect(createBatch(db,testKey,{ ...input, codes: ["01","01"] })).rejects.toThrow("DUPLICATE_CODES");
 await expect(createBatch(db,testKey,{ ...input, codes: [" 01"] })).rejects.toThrow();
 await expect(createBatch(db,testKey,{ ...input, productId: crypto.randomUUID(), codes: ["01"] })).rejects.toThrow("PRODUCT_NOT_FOUND");
 sqlite.close();
});

it("列表支援分頁、精確碼查詢與狀態篩選；跨產品不能撤銷或匯出", async () => {
 const { listCodes,changeCodeStatus,exportCodes }=await import("../src/lib/server/inventory");
 const {db,sqlite}=testDatabase();
 const a=await createProduct(db,{name:"A",slug:"a"});const b=await createProduct(db,{name:"B",slug:"b"});
 const batch=await createBatch(db,testKey,{productId:a.id,name:"Batch",kind:"external",source:"manual",codes:["00001","00002","00003"]});
 const first=await listCodes(db,{productId:a.id,pageSize:2});expect(first.total).toBe(3);expect(first.codes).toHaveLength(2);
 const second=await listCodes(db,{productId:a.id,pageSize:2,page:2});expect(second.codes).toHaveLength(1);
 expect(first.codes.map(c=>c.id)).not.toContain(second.codes[0].id);
 const found=await listCodes(db,{productId:a.id,code:"00002"});expect(found.codes).toHaveLength(1);
 const ids=[found.codes[0].id];expect((await changeCodeStatus(db,{productId:b.id,ids,action:"revoke"})).changed).toBe(0);
 expect((await changeCodeStatus(db,{productId:a.id,ids,action:"revoke"})).changed).toBe(1);
 expect((await changeCodeStatus(db,{productId:a.id,ids,action:"revoke"})).changed).toBe(0);
 expect((await listCodes(db,{productId:a.id,status:"revoked"})).total).toBe(1);
 expect((await changeCodeStatus(db,{productId:a.id,ids,action:"restore"})).changed).toBe(1);
 expect((await listCodes(db,{productId:a.id,status:"available"})).total).toBe(3);
 expect(await exportCodes(db,testKey,{productId:b.id,batchId:batch.id})).toEqual([]);
 expect((await exportCodes(db,testKey,{productId:a.id,batchId:batch.id})).map(r=>r.code).sort()).toEqual(["00001","00002","00003"]);
 sqlite.close();
});
