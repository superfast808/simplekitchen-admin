import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function DebugExportButton({page,from,to,day="all"}:{page:string;from:Date;to:Date;day?:string}){
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function download(){
  setBusy(true);setError("");
  try {
   const q=new URLSearchParams({page,from:from.toISOString(),to:to.toISOString(),day});
   const response=await fetch("/api/debug/export?"+q,{credentials:"include",cache:"no-store"});
   if(!response.ok){const err=await response.json().catch(()=>({}));throw Error(err.message||"Export failed: HTTP "+response.status)}
   const blob=await response.blob(),url=URL.createObjectURL(blob);
   const link=document.createElement("a");link.href=url;link.download=`simple-kitchen-${page}-debug-${from.toISOString().slice(0,10)}.json`;
   document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="inline-flex flex-col gap-1"><Button variant="outline" size="sm" disabled={busy} onClick={download}><Download className="w-4 h-4 mr-2"/>{busy?"Exporting…":"Download Debug Export"}</Button>{error&&<span className="text-xs text-destructive">{error}</span>}</div>;
}
