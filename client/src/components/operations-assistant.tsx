import {getOrderWindow} from "@/components/date-filter";
import {useEffect,useState} from "react";
import type {ReactNode} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card,CardContent} from "@/components/ui/card";
import {Bot,Send,X,BarChart3,Trash2} from "lucide-react";
type Assessment={kind:"verified"|"needs_review"|"insufficient_data";label:string;scope:string;eligibleOrders:number;units:number;matchedProducts:{name:string;quantity:number}[];provenance:string;limitations:string};
type Reply={assessment?:Assessment;question:string;answer:string;deliveryScope?:string;checkedAt:string;chart?:{title:string;bars:{name:string;quantity:number}[]}|null;error?:string};
function range(){
 const today=new Date(),from=new Date(today);
 from.setDate(today.getDate()-7);
 return {from:from.toISOString(),to:today.toISOString()};
}
function RichAnswer({content}:{content:string}){
 const inline=(value:string)=>value.split(/(\*\*[^*]+\*\*)/g).map((part,i)=>part.startsWith("**")&&part.endsWith("**")?<strong key={i}>{part.slice(2,-2)}</strong>:part);
 const lines=content.split("\n");
 const blocks:ReactNode[]=[];
 for(let i=0;i<lines.length;){
  const value=lines[i].trim();
  if(!value){i++;continue}
  if(value.startsWith("|")){
   const records:string[][]=[];
   while(i<lines.length&&lines[i].trim().startsWith("|")){
    const cells=lines[i].trim().replace(/^\|/,"").replace(/\|$/,"").split("|").map(c=>c.trim());
    if(!cells.every(c=>/^:?-+:?$/.test(c)))records.push(cells);
    i++;
   }
   if(records.length){
    const cols=Math.max(...records.map(row=>row.length));
    if(cols===2){
     blocks.push(<div key={"t"+i} className="rounded-xl border overflow-hidden">{records.slice(1).map((row,j)=><div key={j} className={"flex justify-between items-start gap-3 px-3 py-2 text-xs "+(j%2?"bg-muted/40":"bg-background")}><span className="min-w-0 flex-1 break-words">{inline(row[0]||"")}</span><strong className="text-right shrink-0 tabular-nums text-[#314d40]">{inline(row[1]||"")}</strong></div>)}</div>);
    }else{
     blocks.push(<div key={"t"+i} className="w-full max-w-full overflow-x-auto rounded-xl border" tabIndex={0} aria-label="Assistant results table"><table className="w-full min-w-[340px] text-xs border-collapse"><thead className="bg-[#edf3ec] text-[#314d40]"><tr>{Array.from({length:cols},(_,j)=><th key={j} scope="col" className={"px-3 py-2 text-left font-semibold "+(j?"text-right":"")}>{inline(records[0]?.[j]||"")}</th>)}</tr></thead><tbody>{records.slice(1).map((row,j)=><tr key={j} className={j%2?"bg-muted/30":""}>{Array.from({length:cols},(_,k)=><td key={k} className={"px-3 py-2 border-t align-top "+(k?"text-right tabular-nums":"max-w-[180px] break-words")}>{inline(row[k]||"")}</td>)}</tr>)}</tbody></table></div>);
    }
   }
   continue;
  }
  if(value.startsWith("### ")||value.startsWith("## ")||value.startsWith("# ")){blocks.push(<h4 key={i} className="font-semibold text-[#314d40] pt-1">{inline(value.replace(/^#+ /,""))}</h4>);i++;continue}
  if(/^[-*] /.test(value)){blocks.push(<div key={i} className="flex gap-2 pl-1"><span className="text-[#63826a]">•</span><span>{inline(value.slice(2))}</span></div>);i++;continue}
  blocks.push(<p key={i}>{inline(value)}</p>);i++;
 }
 return <div className="text-sm space-y-2 leading-relaxed">{blocks}</div>;
}
export function OperationsAssistant({context="admin"}:{context?:string}){
 const [open,setOpen]=useState(false),[text,setText]=useState(""),[messages,setMessages]=useState<Reply[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [weekOffset,setWeekOffset]=useState(0),[day,setDay]=useState("saturday");
 const [loadingStage,setLoadingStage]=useState(0);
 useEffect(()=>{if(!busy){setLoadingStage(0);return}const timer=window.setInterval(()=>setLoadingStage(n=>Math.min(2,n+1)),2200);return()=>window.clearInterval(timer)},[busy]);
 const send=async(q:string)=>{
  if(!q.trim()||busy)return;
  setBusy(true);setError("");setText("");
  try{
   const {from,to}=getOrderWindow(weekOffset);
   const response=await fetch("/api/operations-ai/chat",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,from:from.toISOString(),to:to.toISOString(),day,context,history:messages.slice(-6).map(m=>({question:m.question,answer:m.answer}))})});
   const payload=await response.json();
   if(!response.ok)throw Error(payload.message||"Assistant unavailable");
   setMessages(prev=>[...prev,{question:q,...payload}]);
  }catch(e:any){setError(e.message);setText(q)}finally{setBusy(false)}
 };
 return <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
  {open&&<Card className="w-[min(94vw,430px)] h-[min(76vh,610px)] shadow-2xl flex flex-col overflow-hidden">
   <div className="flex items-center justify-between bg-[#314d40] text-white p-3"><div className="flex items-center gap-2"><Bot className="w-5 h-5"/><div><strong>Simple Kitchen Assistant</strong><div className="text-[11px] opacity-80">Read-only · live operational checks</div></div></div><div className="flex gap-3 items-center"><button type="button" disabled={busy} title="Clear conversation" aria-label="Clear conversation" onClick={()=>{setMessages([]);setError("");setText("")}}><Trash2 className="w-4 h-4"/></button><button type="button" aria-label="Close assistant" onClick={()=>setOpen(false)}><X className="w-5 h-5"/></button></div></div>
   <div className="px-3 pt-3 flex flex-wrap gap-2 items-center"><label className="text-xs">Kitchen week <select value={weekOffset} onChange={e=>setWeekOffset(Number(e.target.value))} className="bg-background border rounded p-1"><option value={-2}>Two weeks ago</option><option value={-1}>Previous week</option><option value={0}>Current week</option><option value={1}>Next week</option></select></label><label className="text-xs">Delivery <select value={day} onChange={e=>setDay(e.target.value)} className="bg-background border rounded p-1"><option value="saturday">Saturday only</option><option value="tuesday">Tuesday only</option><option value="all">Both (separate)</option><option value="xmas">Christmas</option></select></label></div>
   <CardContent className="flex-1 overflow-y-auto p-3 space-y-3">
    {!messages.length&&<div className="space-y-2"><p className="text-sm text-muted-foreground">Answers default to Saturday only, using the same Sat–Thu order window as Kitchen Production. Choose Tuesday or Both explicitly. Ask about orders, kitchen totals, subscriptions, ingredients and discrepancies.</p>{["How many Firecracker meals for Saturday?","Which orders contribute to Fajita Beef?","Does Saturday prep look consistent?"].map(q=><Button key={q} variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={()=>send(q)}>{q}</Button>)}</div>}
    {messages.map((m,i)=><div key={i} className="space-y-2 border-b pb-3"><div className="text-sm font-semibold">{m.question}</div>{m.deliveryScope&&<p className="text-xs font-bold text-[#314d40]">Figures: {m.deliveryScope}</p>}<RichAnswer content={m.answer}/>{m.assessment&&<div className="rounded-lg border p-3 space-y-2 text-xs">
 <div className="flex flex-wrap items-center justify-between gap-2">
 <strong className="text-[#314d40]">{m.assessment.kind==="verified"?"✓ Evidence checked":m.assessment.kind==="needs_review"?"⚠ Needs clarification":"Evidence unavailable"}</strong>
 <span className="text-muted-foreground">{m.assessment.scope}</span>
 </div>
 <p>{m.assessment.label}</p>
 {!!m.assessment.matchedProducts?.length&&<div className="space-y-1">{m.assessment.matchedProducts.map(p=><div key={p.name} className="flex justify-between gap-2"><span>{p.name}</span><strong>{p.quantity}</strong></div>)}</div>}
 <details><summary className="cursor-pointer font-medium text-[#314d40]">How this was checked</summary>
 <p className="mt-2">{m.assessment.provenance}</p>
 <p>{m.assessment.eligibleOrders} eligible orders · {m.assessment.units} food/product units in selected scope.</p>
 <p className="text-muted-foreground mt-1">{m.assessment.limitations}</p></details>
 </div>}{m.chart&&<div className="border rounded-lg p-2 space-y-2"><div className="flex items-center gap-2 text-xs font-semibold"><BarChart3 className="w-4 h-4"/>{m.chart.title}</div>{m.chart.bars.map(b=><div key={b.name} className="text-xs space-y-1"><div className="flex justify-between gap-2"><span className="truncate">{b.name}</span><strong>{b.quantity}</strong></div><div className="rounded bg-muted h-2 overflow-hidden"><div className="h-full bg-[#63826a]" style={{width:Math.max(1,100*b.quantity/Math.max(1,...m.chart!.bars.map(x=>x.quantity)))+"%"}}/></div></div>)}</div>}<p className="text-[10px] text-muted-foreground">Checked {new Date(m.checkedAt).toLocaleString("en-GB")} · Figures are database-derived, not independently packed quantities</p></div>)}
    {busy&&<div role="status" aria-live="polite" className="rounded-xl border bg-[#f5f8f3] p-3 space-y-2">
      <p className="text-xs font-semibold text-[#314d40]">Reviewing your question</p>
      <div className="flex flex-wrap gap-1.5">{["Checking records","Reviewing figures","Preparing answer"].map((label,i)=><span key={label} className={"rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors "+(loadingStage===i?"bg-[#314d40] text-white":loadingStage>i?"bg-emerald-100 text-emerald-900":"bg-slate-100 text-slate-500")}>{loadingStage===i?"● ":""}{label}</span>)}</div>
      <p className="text-[11px] text-muted-foreground">Progress indicators are illustrative while the server prepares the answer.</p>
    </div>}
    {error&&<p className="text-sm text-red-700" role="alert">{error}</p>}
   </CardContent>
   <form className="p-3 border-t flex gap-2" onSubmit={e=>{e.preventDefault();send(text)}}><Input value={text} disabled={busy} maxLength={1200} onChange={e=>setText(e.target.value)} placeholder="Ask about this week's orders…" aria-label="Ask operations assistant"/><Button disabled={busy||!text.trim()} type="submit" size="icon"><Send className="w-4 h-4"/></Button></form>
  </Card>}
  <Button className="bg-[#314d40] hover:bg-[#45634b] rounded-full shadow-xl gap-2 h-12 px-4" onClick={()=>setOpen(v=>!v)} aria-label={open?"Close Simple Kitchen Assistant":"Open Simple Kitchen Assistant"}><Bot className="w-5 h-5"/>{open?"Close":"Ask Simple Kitchen"}</Button>
 </div>;
}
