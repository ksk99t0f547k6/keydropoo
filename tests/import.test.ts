import { expect,it } from "vitest";
import { utils,write } from "xlsx";
import { parseImport,previewImport,codeWorkbook } from "../src/lib/domain/import-codes";
it("CSV 保留前導零、逗號與引號，映射可選欄位",()=>{
 const bytes=new TextEncoder().encode('note,key\r\nfirst,00012\r\nsecond,"a,b"\r\nthird,"a""b"\r\n');
 const sheet=parseImport(bytes.buffer,"codes.csv")[0];
 expect(previewImport(sheet,1).map(r=>r.code)).toEqual(["00012","a,b",'a"b']);
});
it("預覽保留原始列號，標示空白、重複與不合法碼",()=>{
 const sheet=parseImport(new TextEncoder().encode('code,note\n001,a\n001,b\n,c\n 002,d\n').buffer,"codes.csv")[0];
 expect(previewImport(sheet,0).map(r=>[r.row,r.issue])).toEqual([[2,undefined],[3,"DUPLICATE_CODE"],[4,"EMPTY_CODE"],[5,"INVALID_CODE"]]);
});
it("Excel 匯出碼明確為文字，公式形狀與前導零可完整往返",()=>{
 const rows=[{code:"000001"},{code:"=SUM(1,2)"},{code:"12345678901234567890"}];
 const sheet=parseImport(codeWorkbook(rows),"codes.xlsx")[0];
 expect(previewImport(sheet,0).map(r=>({code:r.code,issue:r.issue}))).toEqual(rows.map(r=>({...r,issue:undefined})));
});
it("拒絕公式儲存格與可能已失真數字",()=>{
 const book=utils.book_new();const sheet=utils.aoa_to_sheet([["code"],[1],[1234567890123456]]);sheet.A2={t:"n",v:1,f:"1+0"};utils.book_append_sheet(book,sheet,"codes");
 expect(previewImport(parseImport(write(book,{bookType:"xlsx",type:"array"}),"codes.xlsx")[0],0).map(r=>r.issue)).toEqual(["FORMULA_CELL","UNSAFE_NUMBER"]);
});
it("拒絕超限、錯誤副檔名和無效映射",()=>{
 expect(()=>parseImport(new ArrayBuffer(5*1024*1024+1),"codes.xlsx")).toThrow("FILE_TOO_LARGE");
 expect(()=>parseImport(new ArrayBuffer(0),"codes.xls")).toThrow("UNSUPPORTED_FILE");
 expect(()=>previewImport({name:"x",rows:[]},-1)).toThrow("INVALID_COLUMN");
 const csv=["code",...Array.from({length:1001},(_,i)=>String(i))].join("\n");
 expect(()=>parseImport(new TextEncoder().encode(csv).buffer,"codes.csv")).toThrow("IMPORT_TOO_LARGE");
});
