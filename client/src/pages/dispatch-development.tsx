import { useMemo,useState } from "react";
import { useQuery,useMutation,useQueryClient } from "@tanstack/react-query";
import { useDateFilter,DateFilter } from "@/components/date-filter";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Truck,UserPlus,GripVertical } from "lucide-react";
type Driver={id:string;name:string;registration:string|null;photoUrl:string|null;email:string|null;enabled:boolean};
type Stop={id:number;wooId:number|null;customerName:string;fulfillment:string;address:string|null;items:{name:string;quantity:number}[];driverId:string|null;sequence:number|null;state:string};
const json=async(url:string,init?:RequestInit)=>{const res=await fetch(url,{credentials:"include",...init});const value=await res.json();if(!res.ok)throw Error(value.message||"Request failed");return value};
const nextDate=(day:"saturday"|"tuesday")=>{const d=new Date();const target=day==="saturday"?6:2;d.setDate(d.getDate()+(target-d.getDay()+7)%7);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")};
export default function DispatchDevelopment({day}:{day:"saturday"|"tuesday"}){
 const dates=useDateFilter(),[routeDate,setRouteDate]=useState(()=>nextDate(day)),[error,setError]=useState(""),[name,setName]=useState(""),[registration,setRegistration]=useState(""),[email,setEmail]=useState(""),[photoUrl,setPhotoUrl]=useState("");
 const query=useQueryClient();
 const {data:testMode}=useQuery<{enabled:boolean;liveNotifications:boolean}>({queryKey:["dispatch-test-mode"],queryFn:()=>json("/api/dispatch/test-mode")});
 const {data:drivers=[]}=useQuery<Driver[]>({queryKey:["dispatch-drivers"],queryFn:()=>json("/api/dispatch/drivers")});
 const qs=new URLSearchParams({day,date:routeDate,from:dates.from.toISOString(),to:dates.to.toISOString()});
 const {data,isLoading,refetch}=useQuery<{stops:Stop[]}>({queryKey:["dispatch-board",qs.toString()],queryFn:()=>json("/api/dispatch/board?"+qs)});
 const add=useMutation({mutationFn:()=>json("/api/dispatch/drivers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,registration,email,photoUrl})}),onSuccess:()=>{setName("");setRegistration("");setEmail("");setPhotoUrl("");query.invalidateQueries({queryKey:["dispatch-drivers"]})},onError:(e:Error)=>setError(e.message)});
 const assign=useMutation({mutationFn:({id,driverId}:{id:number;driverId:string|null})=>json("/api/dispatch/assign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({orderId:id,driverId,day,routeDate})}),onSuccess:()=>query.invalidateQueries({queryKey:["dispatch-board"]}),onError:(e:Error)=>setError(e.message)});
 const stops=data?.stops||[];
 const columns=useMemo(()=>[{id:null,name:"Unassigned"},...drivers.filter(d=>d.enabled).map(d=>({id:d.id,name:d.name}))],[drivers]);
 return <div className="p-4 md:p-6 space-y-5">
  <div className="flex flex-wrap justify-between items-center gap-3"><div><h1 className="text-2xl font-semibold">{day==="saturday"?"Saturday":"Tuesday"} Driver Dispatch</h1><p className="text-sm text-muted-foreground">Development copy · existing routes unaffected</p></div><Badge variant="outline" className="border-amber-400 text-amber-700">IN DEVELOPMENT — NOT LIVE</Badge></div>
  <div className="flex flex-wrap items-center gap-2"><DateFilter {...dates} testIdPrefix={"dispatch-"+day}/><Input type="date" aria-label="Delivery date" className="w-40" value={routeDate} onChange={e=>setRouteDate(e.target.value)}/><Button variant="outline" onClick={()=>refetch()}>Refresh board</Button></div>
  <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="w-4 h-4"/>Add driver</CardTitle></CardHeader><CardContent><form className="grid sm:grid-cols-5 gap-2" onSubmit={e=>{e.preventDefault();add.mutate()}}><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Driver name" required/><Input value={registration} onChange={e=>setRegistration(e.target.value)} placeholder="Reg plate (optional)"/><Input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email for future login"/><Input type="url" value={photoUrl} onChange={e=>setPhotoUrl(e.target.value)} placeholder="Photo HTTPS URL"/><Button disabled={add.isPending} type="submit">Add driver</Button></form>{error&&<p className="text-red-600 text-sm mt-2" role="alert">{error}</p>}</CardContent></Card>
  {testMode?.enabled&&<Badge variant="outline">Driver test mode enabled</Badge>}{testMode?.liveNotifications&&<p className="text-sm text-amber-700 font-semibold">Customer dispatch notifications are enabled — test carefully.</p>}
  <p className="text-sm text-muted-foreground">Drag each order card into a driver column, or use its driver dropdown on mobile. These assignments are saved only to the new development dispatch board.</p>
  <div className="flex gap-3 overflow-x-auto pb-4">{columns.map(column=><div key={column.id||"unassigned"} className="w-72 shrink-0 rounded-xl border bg-muted/20 p-3 space-y-3" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const id=Number(e.dataTransfer.getData("text/plain"));if(id)assign.mutate({id,driverId:column.id})}}>
   <div className="flex items-center gap-2 font-semibold">{drivers.find(d=>d.id===column.id)?.photoUrl?<img className="w-9 h-9 rounded-full object-cover border" src={drivers.find(d=>d.id===column.id)?.photoUrl||""} alt="" loading="lazy"/>:<Truck className="w-4 h-4"/>}<div><div>{column.name}</div><div className="text-xs font-normal text-muted-foreground">{drivers.find(d=>d.id===column.id)?.registration||""}</div></div><Badge variant="secondary">{stops.filter(s=>s.driverId===column.id).length}</Badge></div>{column.id&&testMode?.enabled&&<Button size="sm" variant="outline" onClick={async()=>{try{await json("/api/dispatch/test-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({driverId:column.id})});window.location.assign("/driver")}catch(e:any){setError(e.message)}}}>Test as driver</Button>}
   {isLoading?<p>Loading stops…</p>:stops.filter(s=>s.driverId===column.id).map(stop=><div key={stop.id} draggable onDragStart={e=>e.dataTransfer.setData("text/plain",String(stop.id))} className="rounded-lg border bg-background p-3 shadow-sm space-y-2">
    <div className="flex gap-2 items-center"><GripVertical className="w-4 h-4 text-muted-foreground"/><strong className="text-sm">{stop.customerName}</strong></div><p className="text-xs text-muted-foreground">Order #{stop.wooId||stop.id} · {stop.fulfillment}</p>
    <p className="text-xs">{stop.items.map(i=>i.quantity+"× "+i.name).join(" · ")}</p>
    <select className="w-full text-xs rounded border p-2 bg-background" aria-label={"Assign "+stop.customerName} value={stop.driverId||""} onChange={e=>assign.mutate({id:stop.id,driverId:e.target.value||null})}><option value="">Unassigned</option>{drivers.filter(d=>d.enabled).map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select>
   </div>)}
  </div>)}</div>
 </div>
}