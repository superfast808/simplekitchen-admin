import {getOrderWindow} from "@/components/date-filter";
import {useState} from "react";
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
 const inline=(line:string)=>line.split(/(\\*\\*[^*]+\\*\\*)/g).map((part,i)=>part.startsWith("**")&&part.endsWith("**")?<strong key={i}>{part.slice(2,-2)}</strong>:part);
 const lines=content.split("\\n");
 return <div className="text-sm space-y-2 leading-relaxed">{lines.map((line,i)=>{
  const value=line.trim();
  if(!value)return null;
  if(/^\\|/.test(value)){const cells=value.split("|").slice(1,-1).map(c=>c.trim());if(cells.every(c=>/^:?-+:?$/.test(c)))return null;return <div key={i} className="grid grid-cols-2 gap-2 rounded bg-muted/40 px-2 py-1 text-xs">{cells.map((cell,j)=><span key={j} className={j>0?"text-right":""}>{inline(cell)}</span>)}</div>}
  if(value.startsWith("### ")||value.startsWith("## "))return <h4 key={i} className="font-semibold text-[#314d40] pt-1">{inline(value.replace(/^#+ /,""))}</h4>;
  if(/^[-*] /.test(value))return <div key={i} className="flex gap-2 pl-1"><span className="text-[#63826a]">•</span><span>{inline(value.slice(2))}</span></div>;
  return <p key={i}>{inline(value)}</p>;
 })}</div>
}
export function OperationsAssistant({context="admin"}:{context?:string}){
 const [open,setOpen]=useState(false),[text,setText]=useState(""),[messages,setMessages]=useState<Reply[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [weekOffset,setWeekOffset]=useState(0),[day,setDay]=useState("saturday");
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
    {busy&&<p className="text-sm animate-pulse">Checking records and calculation rules…</p>}
    {error&&<p className="text-sm text-red-700" role="alert">{error}</p>}
   </CardContent>
   <form className="p-3 border-t flex gap-2" onSubmit={e=>{e.preventDefault();send(text)}}><Input value={text} disabled={busy} maxLength={1200} onChange={e=>setText(e.target.value)} placeholder="Ask about this week's orders…" aria-label="Ask operations assistant"/><Button disabled={busy||!text.trim()} type="submit" size="icon"><Send className="w-4 h-4"/></Button></form>
  </Card>}
  <Button className="bg-[#314d40] hover:bg-[#45634b] rounded-full shadow-xl gap-2 h-12 px-4" onClick={()=>setOpen(v=>!v)} aria-label={open?"Close Simple Kitchen Assistant":"Open Simple Kitchen Assistant"}><Bot className="w-5 h-5"/>{open?"Close":"Ask Simple Kitchen"}</Button>
 </div>;
}
