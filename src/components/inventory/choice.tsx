"use client";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/motion/select";
export function Choice({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(value:string)=>void;options:{value:string;label:string}[];disabled?:boolean}) {
 return <div className="min-w-0 space-y-2"><p className="text-sm font-medium">{label}</p><Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="min-w-0"><span className="sr-only">{label}: </span><SelectValue className="min-w-0 flex-1 truncate text-left"/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select></div>;
}
