import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card,CardContent} from "@/components/ui/card";
import {Bot,Send,X,BarChart3} from "lucide-react";
type Reply={question:string;answer:string;checkedAt:string;chart?:{title:string;bars:{name:string;quantity:number}[]}|null;error?:string};
function range(){
 const today=new Date(),from=new Date(today);
 from.setDate(today.getDate()-7);
 return {from:from.toISOString(),to:today.toISOString()};
}
export function OperationsAssistant({context="admin"}:{context?:string}){
 const [open,setOpen]=useState(false),[text,setText]=useState(""),[messages,setMessages]=useState<Reply[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [days,setDays]=useState("7"),[day,setDay]=useState("all");
 const send=async(q:string)=>{
  if(!q.trim()||busy)return;
  setBusy(true);setError("");setText("");
  try{
   const to=new Date(),from=new Date(to);from.setDate(from.getDate()-Number(days));
   const response=await fetch("/api/operations-ai/chat",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({question:q,from:from.toISOString(),to:to.toISOString(),day,context})});
   const payload=await response.json();
   if(!response.ok)throw Error(payload.message||"Assistant unavailable");
   setMessages(prev=>[...prev,{question:q,...payload}]);
  }catch(e:any){setError(e.message);setText(q)}finally{setBusy(false)}
 };
 return <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
  {open&&<Card className="w-[min(94vw,430px)] h-[min(76vh,610px)] shadow-2xl flex flex-col overflow-hidden">
   <div className="flex items-center justify-between bg-[#314d40] text-white p-3"><div className="flex items-center gap-2"><Bot className="w-5 h-5"/><div><strong>Simple Kitchen Assistant</strong><div className="text-[11px] opacity-80">Read-only · live operational checks</div></div></div><button aria-label="Close assistant" onClick={()=>setOpen(false)}><X className="w-5 h-5"/></button></div>
   <div className="px-3 pt-3 flex flex-wrap gap-2 items-center"><label className="text-xs">Period <select value={days} onChange={e=>setDays(e.target.value)} className="bg-background border rounded p-1"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label><label className="text-xs">Delivery <select value={day} onChange={e=>setDay(e.target.value)} className="bg-background border rounded p-1"><option value="all">Both</option><option value="saturday">Saturday</option><option value="tuesday">Tuesday</option><option value="xmas">Christmas</option></select></label></div>
   <CardContent className="flex-1 overflow-y-auto p-3 space-y-3">
    {!messages.length&&<div className="space-y-2"><p className="text-sm text-muted-foreground">Ask questions about orders, kitchen totals, subscriptions, ingredients and potential discrepancies.</p>{["Which meals have missing recipes?","Do Kitchen Production and Orders agree?","Show me the largest production quantities"].map(q=><Button key={q} variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={()=>send(q)}>{q}</Button>)}</div>}
    {messages.map((m,i)=><div key={i} className="space-y-2 border-b pb-3"><div className="text-sm font-semibold">{m.question}</div><p className="text-sm whitespace-pre-wrap">{m.answer}</p>{m.chart&&<div className="border rounded-lg p-2 space-y-2"><div className="flex items-center gap-2 text-xs font-semibold"><BarChart3 className="w-4 h-4"/>{m.chart.title}</div>{m.chart.bars.map(b=><div key={b.name} className="text-xs space-y-1"><div className="flex justify-between gap-2"><span className="truncate">{b.name}</span><strong>{b.quantity}</strong></div><div className="rounded bg-muted h-2 overflow-hidden"><div className="h-full bg-[#63826a]" style={{width:Math.max(1,100*b.quantity/Math.max(1,...m.chart!.bars.map(x=>x.quantity)))+"%"}}/></div></div>)}</div>}<p className="text-[10px] text-muted-foreground">Checked {new Date(m.checkedAt).toLocaleString("en-GB")} · Figures are database-derived, not independently packed quantities</p></div>)}
    {busy&&<p className="text-sm animate-pulse">Checking records and calculation rules…</p>}
    {error&&<p className="text-sm text-red-700" role="alert">{error}</p>}
   </CardContent>
   <form className="p-3 border-t flex gap-2" onSubmit={e=>{e.preventDefault();send(text)}}><Input value={text} disabled={busy} maxLength={1200} onChange={e=>setText(e.target.value)} placeholder="Ask about this week's orders…" aria-label="Ask operations assistant"/><Button disabled={busy||!text.trim()} type="submit" size="icon"><Send className="w-4 h-4"/></Button></form>
  </Card>}
  <Button className="bg-[#314d40] hover:bg-[#45634b] rounded-full shadow-xl gap-2 h-12 px-4" onClick={()=>setOpen(v=>!v)} aria-label={open?"Close Simple Kitchen Assistant":"Open Simple Kitchen Assistant"}><Bot className="w-5 h-5"/>{open?"Close":"Ask Simple Kitchen"}</Button>
 </div>;
}
