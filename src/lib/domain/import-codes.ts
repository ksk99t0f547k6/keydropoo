import { read, utils, write, type WorkBook } from "xlsx";

export type ImportIssue = "EMPTY_CODE" | "INVALID_CODE" | "DUPLICATE_CODE" | "FORMULA_CELL" | "UNSAFE_NUMBER";
export interface ImportCell { text:string; issue?:ImportIssue }
export interface ImportSheet { name:string; rows:ImportCell[][] }
export interface ImportPreview { row:number; code:string; issue?:ImportIssue }
export function parseImport(data:ArrayBuffer, filename:string):ImportSheet[] {
 if(data.byteLength > 5*1024*1024) throw new Error("FILE_TOO_LARGE");
 if(!/\.(xlsx|csv)$/i.test(filename)) throw new Error("UNSUPPORTED_FILE");
 const book = read(data,{type:"array",raw:true,cellText:true,cellFormula:true,sheetRows:1002});
 return book.SheetNames.map((name) => {
  const sheet=book.Sheets[name]; const range=utils.decode_range(sheet["!ref"] ?? "A1");
  const fullRange=utils.decode_range(sheet["!fullref"] ?? sheet["!ref"] ?? "A1");
  if(fullRange.e.r>1000 || range.e.c>63) throw new Error("IMPORT_TOO_LARGE");
  const rows:ImportCell[][]=[];
  for(let r=0;r<=range.e.r;r++) {
   const row:ImportCell[]=[];
   for(let c=0;c<=range.e.c;c++) {
    const cell=sheet[utils.encode_cell({r,c})];
    let issue:ImportIssue|undefined;
    if(cell?.f) issue="FORMULA_CELL";
    if(cell?.t==="n" && (!Number.isSafeInteger(cell.v) || Math.abs(cell.v)>=1e15)) issue="UNSAFE_NUMBER";
    row.push({text:cell ? String(cell.w ?? cell.v ?? "") : "",...(issue?{issue}:{})});
   }
   rows.push(row);
  }
  return {name,rows};
 });
}
export function previewImport(sheet:ImportSheet,column:number,header=true):ImportPreview[] {
 if(!Number.isInteger(column)||column<0||column>63) throw new Error("INVALID_COLUMN");
 const seen=new Set<string>(); const result:ImportPreview[]=[];
 sheet.rows.forEach((row,index) => {
  if(header&&index===0) return;
  if(row.every((c)=>c.text===""&&!c.issue)) return;
  const cell=row[column]; const code=cell?.text ?? "";
  let issue=cell?.issue;
  if(!issue) {
   if(!code) issue="EMPTY_CODE";
   else if(code.length>512||code!==code.trim()||/[\r\n\u0000]/.test(code)) issue="INVALID_CODE";
   else if(seen.has(code)) issue="DUPLICATE_CODE";
  }
  seen.add(code);result.push({row:index+1,code,issue});
 });
 if(result.length>1000) throw new Error("IMPORT_TOO_LARGE");
 return result;
}
export function codeWorkbook(rows:{code:string;status?:string;expiresAt?:number|null}[]):ArrayBuffer {
 // 每個碼明確寫成字串，避免 Excel 將前導零去掉或把碼當公式。
 const sheet=utils.aoa_to_sheet([["code","status","expires_at"],...rows.map((r)=>[r.code,r.status??"",r.expiresAt ? new Date(r.expiresAt).toISOString():""])]);
 const book:WorkBook=utils.book_new();utils.book_append_sheet(book,sheet,"Codes");
 return write(book,{bookType:"xlsx",type:"array"}) as ArrayBuffer;
}
