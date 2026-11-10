"use client";
import { useState,useRef,type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/motion/button/base";
import { Input } from "@/components/motion/input";
import { Table } from "@/components/motion/table";
import { Checkbox } from "@/components/motion/checkbox";
import { Choice } from "./choice";
import type { ImportSheet,ImportPreview } from "@/lib/domain/import-codes";
import {Notice} from "@/components/dashboard/notice";
export function download(bytes:ArrayBuffer,name:string) {
 const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
 const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function BatchForm({productId,onCreated,target}:{productId:string;onCreated:()=>void;target?:{id:string;name:string;kind:string}}) {
 const t=useTranslations("inventory"); const [mode,setMode]=useState(target?.kind==="external"?"manual":"generated");const [name,setName]=useState("");const [kind,setKind]=useState("redemption");
 const [distributionMode,setDistributionMode]=useState("unique");const [sharedLimit,setSharedLimit]=useState("");
 const [count,setCount]=useState("100");const [prefix,setPrefix]=useState("");const [length,setLength]=useState("20");const [group,setGroup]=useState("5");const [alphabet,setAlphabet]=useState("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
 const [expires,setExpires]=useState("");const [uses,setUses]=useState("1");const [devices,setDevices]=useState("1");const [manual,setManual]=useState("");
 const [sheets,setSheets]=useState<ImportSheet[]>([]);const [sheet,setSheet]=useState("0");const [column,setColumn]=useState("0");const [header,setHeader]=useState(true);const [preview,setPreview]=useState<ImportPreview[]>([]);
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [notice,setNotice]=useState("");
 const pending=useRef<{signature:string;body:string}|null>(null);
 const choices=(keys:string[])=>keys.map(value=>({value,label:t(value)}));
 function failure(code?:string) { return t(`errors.${code && t.has(`errors.${code}`)?code:"generic"}`); }
 function resetPreview(){setPreview([]);setError("");setNotice("");}
 async function load(file:File|undefined) {
  resetPreview();setSheets([]);if(!file)return;setBusy(true);
  try { const {parseImport}=await import("@/lib/domain/import-codes");if(file.size>5*1024*1024)throw new Error("FILE_TOO_LARGE");setSheets(parseImport(await file.arrayBuffer(),file.name));setSheet("0");setColumn("0"); }
  catch(e){setError(failure(e instanceof Error?e.message:undefined));}finally{setBusy(false);}
 }
 async function inspect() {
  setBusy(true);setError("");setPreview([]);
  try {
   const {previewImport}=await import("@/lib/domain/import-codes");
   const rows=mode==="manual" ? previewImport({name:"manual",rows:manual.split(/\r?\n/).map(text=>[{text}])},0,false) : previewImport(sheets[Number(sheet)],Number(column),header);
   if(!rows.length)throw new Error("EMPTY_CODE");
   const r=await fetch("/api/batches/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,codes:rows.map(row=>row.code)})});
   const data=await r.json() as {duplicates?:number[];error?:string};if(!r.ok)throw new Error(data.error);
   setPreview(rows.map((row,i)=>({...row,issue:row.issue??(data.duplicates?.includes(i)?"DUPLICATE_CODE":undefined)})));
  }catch(e){setError(failure(e instanceof Error?e.message:undefined));}finally{setBusy(false);}
 }
 async function submit(event:FormEvent) {
  event.preventDefault();setBusy(true);setError("");setNotice("");
  try {
   if(mode!=="generated" && (!preview.length||preview.some(r=>r.issue)))throw new Error("REVIEW_REQUIRED");
   const body={productId,name,kind,source:mode,distributionMode,sharedClaimLimit:distributionMode==="shared"&&sharedLimit?Number(sharedLimit):null,expiresAt:expires?new Date(expires).getTime():null,maxUses:Number(uses),maxDevices:Number(devices),...(mode==="generated"?{rules:{count:Number(count),prefix,length:Number(length),groupSize:Number(group),alphabet}}:{codes:preview.map(r=>r.code)})};
   let payload=JSON.stringify(body);
   if(target){
    const signature=JSON.stringify({body,batchId:target.id});
    if(pending.current?.signature!==signature){
     const {generateCodes}=await import("@/lib/domain/codes");
     const codes="rules" in body?generateCodes(body.rules):preview.map(r=>r.code);
     pending.current={signature,body:JSON.stringify({productId,batchId:target.id,idempotencyKey:crypto.randomUUID(),codes,expiresAt:body.expiresAt,maxUses:body.maxUses,maxDevices:body.maxDevices})};
    }
    payload=pending.current.body;
   }else{
    const signature=payload;
    if(pending.current?.signature!==signature)pending.current={signature,body:JSON.stringify({...body,idempotencyKey:crypto.randomUUID()})};
    payload=pending.current.body;
   }
   const r=await fetch(target?"/api/batches/restock":"/api/batches",{method:"POST",headers:{"Content-Type":"application/json"},body:payload});const data=await r.json() as {error?:string;count?:number};if(!r.ok)throw new Error(data.error);
   pending.current=null;setNotice(t(target?"restocked":"created",{count:data.count??0}));setPreview([]);setManual("");setSheets([]);setName("");onCreated();
  }catch(e){setError(failure(e instanceof Error?e.message:undefined));}finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="space-y-5"><h2>{target?t("restockBatch",{name:target.name}):t("newBatch")}</h2>{target&&<p className="text-sm text-muted-foreground">{t("restockHint")}</p>}<fieldset disabled={busy} className="space-y-5">
  <div className="grid gap-5 sm:grid-cols-2">{!target&&<Input label={t("batchName")} value={name} onChange={setName} required maxLength={120}/>}<Choice label={t("source")} value={mode} onChange={v=>{setMode(v);resetPreview();if(v==="generated"&&kind==="external")setKind("redemption");}} options={choices(target?.kind==="external"?["manual","import"]:["generated","manual","import"])} disabled={busy}/>{!target&&<Choice label={t("kind")} value={kind} onChange={setKind} options={choices(mode==="generated"?["redemption","discount","license"]:["redemption","discount","license","external"])} disabled={busy}/>}<Input label={t("expires")} type="datetime-local" value={expires} onChange={setExpires}/></div>
  {!target&&<div className="space-y-3"><Choice label={t("distributionMode")} value={distributionMode} onChange={setDistributionMode} options={choices(["unique","shared"])} disabled={busy}/>{distributionMode==="shared"&&<><Input label={t("sharedClaimLimit")} type="number" min={1} max={1000000} value={sharedLimit} onChange={setSharedLimit}/><p className="text-sm text-muted-foreground">{t("sharedHint")}</p></>}</div>}
  <div className="grid gap-5 sm:grid-cols-2"><Input label={t("maxUses")} type="number" min={1} max={1000000} value={uses} onChange={setUses} required/><Input label={t("maxDevices")} type="number" min={1} max={10000} value={devices} onChange={setDevices} required/></div>
  {mode==="generated"?<div className="grid gap-5 sm:grid-cols-2"><Input label={t("count")} type="number" min={1} max={1000} value={count} onChange={setCount} required/><Input label={t("prefix")} value={prefix} onChange={setPrefix} maxLength={32}/><Input label={t("length")} type="number" min={12} max={64} value={length} onChange={setLength} required/><Input label={t("groupSize")} type="number" min={0} max={16} value={group} onChange={setGroup} required/><div className="sm:col-span-2"><Input label={t("alphabet")} value={alphabet} onChange={setAlphabet} required/><p className="mt-2 text-sm text-muted-foreground">{t("entropyHint")}</p></div></div>:<>
   {mode==="manual"?<label className="block text-sm">{t("manualCodes")}<textarea className="mt-2 min-h-36 w-full rounded-lg border border-border bg-background p-3 font-mono" value={manual} onChange={e=>{setManual(e.target.value);resetPreview();}}/></label>:<><label className="block text-sm">{t("file")}<input className="mt-2 block w-full rounded-lg border border-border p-3" type="file" accept=".csv,.xlsx" onChange={e=>void load(e.target.files?.[0])}/></label><Button type="button" variant="ghost" onClick={async()=>{const{codeWorkbook}=await import("@/lib/domain/import-codes");download(codeWorkbook([]),"keydrop-import-template.xlsx");}}>{t("template")}</Button>{sheets.length>0&&<div className="grid gap-5 sm:grid-cols-2"><Choice label={t("sheet")} value={sheet} onChange={v=>{setSheet(v);setColumn("0");resetPreview();}} options={sheets.map((s,i)=>({value:String(i),label:s.name}))}/><Choice label={t("column")} value={column} onChange={v=>{setColumn(v);resetPreview();}} options={(sheets[Number(sheet)]?.rows[0]??[]).map((c,i)=>({value:String(i),label:header?c.text||t("unnamedColumn",{number:i+1}):t("unnamedColumn",{number:i+1})}))}/><Checkbox checked={header} onCheckedChange={v=>{setHeader(v);resetPreview();}} label={t("header")}/></div>}</>}
   <Button type="button" variant="outline" disabled={busy||(mode==="import"&&!sheets.length)} onClick={()=>void inspect()}>{t("preview")}</Button>
   {preview.length>0&&<><p className="text-sm text-muted-foreground">{t("previewSummary",{count:preview.length,errors:preview.filter(r=>r.issue).length})}</p><Table data={preview} getRowId={r=>String(r.row)} height={260} columns={[{key:"row",header:t("row"),width:"70px"},{key:"code",header:t("code"),cell:r=><span className="font-mono">{r.code}</span>},{key:"issue",header:t("validation"),cell:r=>r.issue?<span className="text-red-600">{failure(r.issue)}</span>:t("valid")}]} /></>}
  </>}
  <Button type="submit" disabled={busy||(mode!=="generated"&&(!preview.length||preview.some(r=>r.issue)))}>{t(busy?"working":target?"saveRestock":"saveBatch")}</Button>
 </fieldset>{error&&<Notice variant="destructive">{error}</Notice>}{notice&&<Notice variant="success">{notice}</Notice>}</form>;
}
