"use client";
import { useEffect,useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Table } from "@/components/motion/table";
import { Input } from "@/components/motion/input";
import { Button } from "@/components/motion/button/base";
import {StripeExportForm} from "@/components/discounts/stripe-export-form";
import {StripeImportForm} from "@/components/discounts/stripe-import-form";
import {EmailDistributionHistory} from "./email-distribution-history";
import {AssignmentForm,AssignmentHistory} from "./assignment-form";
import { Choice } from "./choice";
import { BatchForm,download } from "./batch-form";
import type { CodeRow } from "@/lib/server/inventory";
import {Notice} from "@/components/dashboard/notice";
type Batch={id:string;name:string;kind:string;source:string;count:number};
export function CodeManager({productId,archived=false}:{productId:string;archived?:boolean}) {
 const router=useRouter();
 const t=useTranslations("inventory");const[rows,setRows]=useState<CodeRow[]>([]);const[batches,setBatches]=useState<Batch[]>([]);const[total,setTotal]=useState(0);
 const[page,setPage]=useState(1);const[status,setStatus]=useState("all");const[batch,setBatch]=useState("all");const[query,setQuery]=useState("");const[search,setSearch]=useState("");
 const[selected,setSelected]=useState<string[]>([]);const[revision,setRevision]=useState(0);const[loading,setLoading]=useState(true);const[busy,setBusy]=useState(false);const[error,setError]=useState("");const[notice,setNotice]=useState("");const[showCreate,setShowCreate]=useState(false);
 const[emailCode,setEmailCode]=useState<CodeRow|null>(null);
 const[assignmentCode,setAssignmentCode]=useState<CodeRow|null>(null);
 const[exportCode,setExportCode]=useState<CodeRow|null>(null);
 const[restock,setRestock]=useState<Batch|null>(null);
 const refresh=()=>{setRevision(v=>v+1);setSelected([]);};
 useEffect(()=>{
 // eslint-disable-next-line react-hooks/set-state-in-effect -- 啟動可取消的遠端載入時重設狀態；依賴固定且會清理舊請求。
  const abort=new AbortController();setLoading(true);setError("");setSelected([]);
  const q=new URLSearchParams({productId,page:String(page)});if(status!=="all")q.set("status",status);if(batch!=="all")q.set("batchId",batch);
  Promise.all([fetch("/api/codes/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...Object.fromEntries(q),...(search?{code:search}:{})}),signal:abort.signal}),fetch(`/api/batches?productId=${productId}`,{signal:abort.signal})]).then(async([r,b])=>{
   if(!r.ok||!b.ok)throw new Error();const data=await r.json() as {codes:CodeRow[];total:number};const list=await b.json() as {batches:Batch[]};
   if(!abort.signal.aborted){setRows(data.codes);setTotal(data.total);setBatches(list.batches);}
  }).catch(()=>{if(!abort.signal.aborted){setRows([]);setError(t("errors.generic"));}}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
  return()=>abort.abort();
 },[productId,page,status,batch,search,revision,t]);
 async function change(action:"revoke"|"restore") {
  setBusy(true);setError("");setNotice("");
  try{const r=await fetch("/api/codes",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,ids:selected,action})});if(!r.ok)throw new Error();const d=await r.json() as {changed:number};setNotice(t("changed",{count:d.changed}));refresh();}
  catch{setError(t("errors.generic"));}finally{setBusy(false);}
 }
 async function exportBatch() {
  setBusy(true);setError("");
  try{const r=await fetch("/api/codes/export",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({productId,batchId:batch})});if(!r.ok)throw new Error();const d=await r.json() as {rows:{code:string;status:string;expiresAt:number|null}[]};const{codeWorkbook}=await import("@/lib/domain/import-codes");download(codeWorkbook(d.rows),`keydrop-${batch}.xlsx`);}
  catch{setError(t("errors.generic"));}finally{setBusy(false);}
 }
 return <div className="space-y-8"><div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-muted-foreground">{t("total",{count:total})}</p><Button disabled={archived} onClick={()=>{setRestock(null);setShowCreate(!showCreate);}}>{t(showCreate?"closeCreate":"newBatch")}</Button></div>
 {!archived&&<StripeImportForm productId={productId} onImported={batchId=>{setBatch(batchId||"all");setStatus("all");setSearch("");setQuery("");setPage(1);refresh();router.refresh();}}/>}
 {emailCode&&!archived&&<AssignmentForm key={`email:${emailCode.id}`} code={emailCode} emailDelivery onAssigned={refresh} onClose={()=>setEmailCode(null)}/>}
 {assignmentCode&&!archived&&<AssignmentForm key={assignmentCode.id} code={assignmentCode} onAssigned={refresh} onClose={()=>setAssignmentCode(null)}/>}
 {exportCode&&!archived&&<StripeExportForm key={exportCode.id} code={exportCode} onUpdated={refresh} onClose={()=>setExportCode(null)}/>}
 {showCreate&&!archived&&<section className="rounded-xl border border-border bg-card p-6"><BatchForm productId={productId} onCreated={()=>{setPage(1);refresh();router.refresh();}}/></section>}
 {restock&&!archived&&<section className="rounded-xl border border-border bg-card p-6"><Button variant="ghost" onClick={()=>setRestock(null)}>{t("closeCreate")}</Button><BatchForm key={restock.id} productId={productId} target={restock} onCreated={()=>{setPage(1);refresh();}}/></section>}
 <div className="grid gap-4 sm:grid-cols-3"><Choice label={t("batch")} value={batch} onChange={v=>{setBatch(v);setPage(1);}} options={[{value:"all",label:t("allBatches")},...batches.map(b=>({value:b.id,label:`${b.name} (${b.count})`}))]}/><Choice label={t("status")} value={status} onChange={v=>{setStatus(v);setPage(1);}} options={["all","available","reserved","assigned","revoked"].map(value=>({value,label:t(value)}))}/><form onSubmit={e=>{e.preventDefault();setSearch(query);setPage(1);}} className="flex items-end gap-2"><Input label={t("search")} value={query} onChange={setQuery}/><Button type="submit" variant="outline">{t("find")}</Button></form></div>
 <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={busy||loading||!selected.length} onClick={()=>void change("revoke")}>{t("revoke")}</Button><Button variant="outline" disabled={busy||loading||!selected.length} onClick={()=>void change("restore")}>{t("restore")}</Button><Button variant="outline" disabled={archived||busy||loading||batch==="all"||batches.find(b=>b.id===batch)?.source==="stripe"} onClick={()=>{setShowCreate(false);setRestock(batches.find(b=>b.id===batch)??null);}}>{t("restock")}</Button><Button variant="ghost" disabled={busy||batch==="all"} onClick={()=>void exportBatch()}>{t("export")}</Button><Button variant="outline" disabled={archived||busy||loading||selected.length!==1||!rows.some(r=>r.id===selected[0]&&r.kind==="discount"&&r.source!=="stripe")} onClick={()=>setExportCode(rows.find(r=>r.id===selected[0])??null)}>{t("pushStripe")}</Button><Button variant="outline" disabled={archived||busy||loading||selected.length!==1||!rows.some(r=>r.id===selected[0]&&!r.source_unavailable&&["available","assigned"].includes(r.status))} onClick={()=>setAssignmentCode(rows.find(r=>r.id===selected[0])??null)}>{t("assign")}</Button><Button variant="outline" disabled={archived||busy||loading||selected.length!==1} onClick={()=>setEmailCode(rows.find(r=>r.id===selected[0])??null)}>{t("emailSelected")}</Button><span className="text-xs text-muted-foreground">{t("selected",{count:selected.length})}</span></div>
 {error&&<Notice variant="destructive">{error}</Notice>}{notice&&<Notice variant="success">{notice}</Notice>}
 <Table data={rows} getRowId={r=>r.id} selectable selectedRowIds={selected} onSelectionChange={setSelected} loading={loading} height={460} emptyState={<p className="p-10 text-muted-foreground">{t("empty")}</p>} columns={[
  {key:"id",header:t("identifier"),cell:r=><span className="font-mono text-xs">{r.id.slice(0,8)}</span>,width:"120px"},
  {key:"batch_name",header:t("batch")},{key:"kind",header:t("kind"),cell:r=>t(r.kind)},
  {key:"status",header:t("status"),cell:r=><span className="rounded bg-muted px-2 py-1 text-xs">{t(r.status)}{r.source_unavailable?` · ${t("sourceUnavailable")}`:""}</span>},
  {key:"use_count",header:t("uses"),cell:r=>(r.source==="stripe"||r.stripe_linked)?t("stripeManaged"): `${r.use_count} / ${r.max_uses}`},
  {key:"expires_at",header:t("expires"),cell:r=>r.expires_at?new Date(r.expires_at).toLocaleString("en"):t("never")}
 ]}/>
 <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">{t("page",{page,pages:Math.max(1,Math.ceil(total/50))})}</span><div className="flex gap-2"><Button variant="outline" disabled={page===1||loading} onClick={()=>setPage(p=>p-1)}>{t("previous")}</Button><Button variant="outline" disabled={page*50>=total||loading} onClick={()=>setPage(p=>p+1)}>{t("next")}</Button></div></div>
 <AssignmentHistory productId={productId} revision={revision}/><EmailDistributionHistory productId={productId} revision={revision}/>
 </div>;
}
