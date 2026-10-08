import { useEffect,useState } from "react";
import { Card,CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
type Order={id:number;wooId:number|null;orderDate:string;status:string;isTuesday:boolean;fulfillmentType:string;instructions:string|null;customerName:string;deliveryAddress:string|null;deliveryDate:string;group:"current"|"upcoming"|"past";journey:string;canEditInstructions:boolean;items:{name:string;quantity:number}[]};
type Invite={token:string;weekFrom:string;weekTo:string;status:string};
async function api(url:string,method="GET",data?:unknown){const r=await fetch(url,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw Error(v.message||"Request failed");return v}
export default function CustomerPortal(){
 const [email,setEmail]=useState(""),[me,setMe]=useState<{email:string;orders:Order[];selectionInvites:Invite[]}|null>(null);
 const [message,setMessage]=useState(""),[loading,setLoading]=useState(false),[editing,setEditing]=useState<number|null>(null),[instructions,setInstructions]=useState("");
 async function reload(){try{setMe(await api("/api/customer/me"))}catch{setMe(null)}}
 useEffect(()=>{const token=new URLSearchParams(window.location.search).get("token");if(token){api("/api/customer/verify","POST",{token}).then(()=>{window.history.replaceState(null,"","/my");reload()}).catch(e=>setMessage(e.message))}else reload()},[]);
 async function login(){setLoading(true);try{const v=await api("/api/customer/access","POST",{email});setMessage(v.message)}catch(e:any){setMessage(e.message)}finally{setLoading(false)}}
 return <div className="min-h-screen" style={{background:"#f4f1e9",color:"#314d40"}}>
 <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
  <header className="flex justify-between items-center border-b pb-4"><div><h1 className="text-2xl font-bold">Simple Kitchen</h1><p className="text-xs uppercase tracking-widest">My account</p></div>{me&&<Button variant="outline" onClick={async()=>{await api("/api/customer/logout","POST");setMe(null)}}>Sign out</Button>}</header>
  {!me?<Card><CardContent className="p-6 space-y-4"><h2 className="text-xl font-semibold">Your Simple Kitchen, all in one place.</h2><p>Follow your orders, see your previous meals and choose your next favourites. No password needed.</p><label className="block text-sm font-medium">Email address</label><Input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/><Button onClick={login} disabled={loading||!email.includes("@")}>{loading?"Sending…":"Email me a secure link"}</Button>{message&&<p role="status" className="text-sm">{message}</p>}</CardContent></Card>:
  <>
   <div className="rounded-2xl p-6 text-white space-y-2" style={{background:"#314d40"}}><p className="text-sm opacity-80">YOUR KITCHEN DASHBOARD</p><h2 className="text-2xl font-semibold">Hello, {me.orders[0]?.customerName?.split(" ")[0]||"there"}!</h2><p>Here’s your order journey and meal selections.</p></div>
   {me.selectionInvites.length>0&&<Card><CardContent className="p-5 space-y-3"><h3 className="text-lg font-semibold">Choose your meals</h3>{me.selectionInvites.filter(x=>x.status==="pending").map(x=><div key={x.token} className="border rounded-lg p-3 flex justify-between gap-2 items-center"><span>Selection for {new Date(x.weekFrom).toLocaleDateString("en-GB")}</span><a className="underline font-semibold" href={"/subscribe/"+encodeURIComponent(x.token)}>Choose meals →</a></div>)}<p className="text-xs text-muted-foreground">Selection uses your existing secure subscription link.</p></CardContent></Card>}
   <h3 className="text-lg font-semibold">Your deliveries</h3>
   {me.orders.length===0&&<p>No eligible orders found yet.</p>}
   {(["current","upcoming","past"] as const).map(group=><section key={group} className="space-y-3"><h4 className="font-semibold text-lg">{group==="current"?"Current deliveries":group==="upcoming"?"Coming up":"Past deliveries"}</h4>{me.orders.filter(o=>o.group===group).length===0?<p className="text-sm opacity-70">No {group} deliveries.</p>:null}{me.orders.filter(o=>o.group===group).map(o=><Card key={o.id}><CardContent className="p-5 space-y-3">
    <div className="flex justify-between gap-2 flex-wrap"><div><h4 className="font-semibold">Order #{o.wooId||o.id}</h4><p className="text-xs">Delivery {new Date(o.deliveryDate+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} · {o.fulfillmentType}</p></div><span className="rounded-full px-3 py-1 text-xs font-semibold self-start" style={{background:"#e6eee6"}}>{["cancelled","refunded"].includes(o.status)? "Cancelled":o.journey}</span></div>
    <ul className="text-sm space-y-1">{o.items.map((it,i)=><li key={i}>{it.quantity} × {it.name}</li>)}</ul>
    {o.deliveryAddress&&<p className="text-xs text-muted-foreground">Delivery: {o.deliveryAddress}</p>}
    {editing===o.id?<div className="space-y-2"><label className="text-sm">Delivery instructions (e.g. gate code, safe location)</label><Textarea value={instructions} maxLength={1000} onChange={e=>setInstructions(e.target.value)}/><div className="flex gap-2"><Button onClick={async()=>{try{await api("/api/customer/orders/"+o.id+"/instructions","PATCH",{instructions});setEditing(null);await reload()}catch(e:any){setMessage(e.message)}}}>Save</Button><Button variant="outline" onClick={()=>setEditing(null)}>Cancel</Button></div>{message&&<p className="text-sm">{message}</p>}</div>:
    <div className="flex justify-between items-center gap-2"><p className="text-sm">Instructions: {o.instructions||"Not supplied"}</p>{o.canEditInstructions&&<Button size="sm" variant="outline" onClick={()=>{setMessage("");setEditing(o.id);setInstructions(o.instructions||"")}}>Edit</Button>}</div>}
   </CardContent></Card>)}</section>)}
  </>}
  <footer className="text-center text-xs opacity-70 py-5">Made with care by Simple Kitchen 🤎</footer>
 </div></div>
}
