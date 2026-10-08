import { useEffect,useState } from "react";
import { Card,CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
type Order={id:number;wooId:number|null;orderDate:string;status:string;isTuesday:boolean;fulfillmentType:string;instructions:string|null;customerName:string;deliveryAddress:string|null;deliveryDate:string;group:"current"|"upcoming"|"past";journey:string;canEditInstructions:boolean;items:{name:string;quantity:number}[]};
type Invite={token:string;weekFrom:string;weekTo:string;status:string};
async function api(url:string,method="GET",data?:unknown){const r=await fetch(url,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:data?JSON.stringify(data):undefined});const v=await r.json();if(!r.ok)throw Error(v.message||"Request failed");return v}
type TrackingStatus={available:boolean;state?:string;driverName?:string;location?:{lat:number;lng:number;updatedAt:string}|null;etaMinutes?:number|null;roadKm?:number|null;etaSource?:string|null;trackingEnabled?:boolean};
function DriverTracking({orderId}:{orderId:number}){
 const [visible,setVisible]=useState(false),[data,setData]=useState<TrackingStatus|null>(null),[error,setError]=useState("");
 useEffect(()=>{
  if(!visible)return;
  let cancelled=false;
  const refresh=()=>api("/api/customer/tracking/"+orderId).then(v=>{if(!cancelled)setData(v)}).catch((e:Error)=>{if(!cancelled)setError(e.message)});
  refresh();const timer=window.setInterval(refresh,30000);
  return()=>{cancelled=true;window.clearInterval(timer)};
 },[visible,orderId]);
 const lat=Number(data?.location?.lat),lng=Number(data?.location?.lng);
 const mapUrl=data?.location?("https://www.openstreetmap.org/export/embed.html?bbox="+encodeURIComponent([lng-.012,lat-.008,lng+.012,lat+.008].join(","))+"&layer=mapnik&marker="+encodeURIComponent(lat+","+lng)):"";
 return <div className="space-y-2"><Button variant="outline" size="sm" onClick={()=>setVisible(v=>!v)}>{visible?"Hide driver tracking":"Track my delivery"}</Button>
 {visible&&<div className="rounded-xl border p-3 space-y-2"><p className="text-sm font-semibold">{data?.available?"Driver: "+data.driverName:"No active driver assignment yet"}</p>
 {data?.available&&<p className="text-xs">Status: {String(data.state||"assigned").replace("_"," ")}</p>}
 {data?.etaMinutes!=null&&<p className="text-sm font-medium">Approx. {data.etaMinutes} min · {data.roadKm} km by road</p>}
 {data?.etaSource&&<p className="text-xs text-muted-foreground">{data.etaSource}. Traffic and stops ahead may change arrival time.</p>}
 {data?.location?<><iframe title="Driver's latest reported position" loading="lazy" src={mapUrl} className="w-full h-56 rounded-lg border"/><p className="text-xs text-muted-foreground">Last updated {new Date(data.location.updatedAt).toLocaleTimeString("en-GB")}. Updates approximately every 30 seconds while the driver shares location.</p></>:<p className="text-xs text-muted-foreground">{data?.trackingEnabled===false?"Live GPS tracking is currently disabled for testing. Your driver assignment and delivery status are still shown.":"Live location will appear when your driver is on the way and has enabled sharing."}</p>}
 {error&&<p role="alert" className="text-xs text-red-600">{error}</p>}</div>}</div>
}
export default function CustomerPortal(){
 const [alerts,setAlerts]=useState<{id:string;title:string;body:string;createdAt:string;read:boolean}[]>([]);
 const [notificationsOn,setNotificationsOn]=useState(false);
 const [installPrompt,setInstallPrompt]=useState<any>(null);
 const [email,setEmail]=useState(""),[me,setMe]=useState<{email:string;orders:Order[];selectionInvites:Invite[]}|null>(null);
 const [message,setMessage]=useState(""),[loading,setLoading]=useState(false),[editing,setEditing]=useState<number|null>(null),[instructions,setInstructions]=useState("");
 async function reload(){try{setMe(await api("/api/customer/me"));setAlerts(await api("/api/customer/alerts"))}catch{setMe(null)}}
 useEffect(()=>{
  if("serviceWorker" in navigator)navigator.serviceWorker.register("/my-sw.js",{scope:"/my"}).catch(()=>{});
  const manifest=document.createElement("link");manifest.rel="manifest";manifest.href="/my-manifest.webmanifest";document.head.appendChild(manifest);
  const theme=document.createElement("meta");theme.name="theme-color";theme.content="#314d40";document.head.appendChild(theme);
  const handler=(e:any)=>{e.preventDefault();setInstallPrompt(e)};
  window.addEventListener("beforeinstallprompt",handler);
  return()=>{window.removeEventListener("beforeinstallprompt",handler);manifest.remove();theme.remove()};
 },[]);
 useEffect(()=>{if(!me)return;const timer=window.setInterval(async()=>{
  try{
   const incoming=await api("/api/customer/alerts");
   setAlerts(old=>{
    const seen=new Set(old.map((x:{id:string})=>x.id));
    if(notificationsOn && "Notification" in window && Notification.permission==="granted")
     incoming.filter((a:{id:string})=>!seen.has(a.id)).forEach((a:{title:string;body:string})=>new Notification(a.title,{body:a.body,icon:"/my-icon.svg"}));
    return incoming;
   });
  }catch{}
 },15000);return()=>window.clearInterval(timer)},[me?.email,notificationsOn]);
 useEffect(()=>{const token=new URLSearchParams(window.location.search).get("token");if(token){api("/api/customer/verify","POST",{token}).then(()=>{window.history.replaceState(null,"","/my");reload()}).catch(e=>setMessage(e.message))}else reload()},[]);
 async function login(){setLoading(true);try{const v=await api("/api/customer/access","POST",{email});setMessage(v.message)}catch(e:any){setMessage(e.message)}finally{setLoading(false)}}
 return <div className="min-h-screen" style={{background:"#f4f1e9",color:"#314d40"}}>
 <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
  <header className="flex justify-between items-center border-b pb-4"><div><h1 className="text-2xl font-bold">Simple Kitchen</h1><p className="text-xs uppercase tracking-widest">My account</p></div>{me&&<Button variant="outline" onClick={async()=>{await api("/api/customer/logout","POST");setMe(null)}}>Sign out</Button>}</header>
  {!me?<Card><CardContent className="p-6 space-y-4"><h2 className="text-xl font-semibold">Your Simple Kitchen, all in one place.</h2><p>Follow your orders, see your previous meals and choose your next favourites. No password needed.</p><label className="block text-sm font-medium">Email address</label><Input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/><Button onClick={login} disabled={loading||!email.includes("@")}>{loading?"Sending…":"Email me a secure link"}</Button>{message&&<p role="status" className="text-sm">{message}</p>}</CardContent></Card>:
  <>
   <div className="flex flex-wrap gap-2">
    {installPrompt&&<Button onClick={async()=>{await installPrompt.prompt();setInstallPrompt(null)}}>Install My Simple Kitchen</Button>}
    <Button variant="outline" onClick={async()=>{
      try {
        if(!("serviceWorker" in navigator)||!("PushManager" in window)||!("Notification" in window))throw Error("This browser does not support push notifications");
        const permission=await Notification.requestPermission();
        if(permission!=="granted")throw Error("Please allow notifications in your browser settings.");
        const key=await api("/api/customer/push/key");
        if(!key.key)throw Error(key.reason || "Push is not configured on the server yet.");
        const registration=await navigator.serviceWorker.ready;
        let sub=await registration.pushManager.getSubscription();
        if(!sub){
          const str=key.key.replace(/-/g,"+").replace(/_/g,"/");
          const bytes=Uint8Array.from(atob(str.padEnd(Math.ceil(str.length/4)*4,"=")),c=>c.charCodeAt(0));
          sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
        }
        await api("/api/customer/push/subscribe","POST",sub.toJSON());
        setNotificationsOn(true);setMessage("Background notifications enabled for this device.");
      }catch(e:any){setMessage(e.message)}
    }}>Enable push notifications</Button>
    {notificationsOn&&<Button size="sm" variant="outline" onClick={async()=>{
      const reg=await navigator.serviceWorker.ready;const sub=await reg.pushManager.getSubscription();
      if(sub){await api("/api/customer/push/unsubscribe","POST",{endpoint:sub.endpoint});await sub.unsubscribe()}
      setNotificationsOn(false);setMessage("Push notifications disabled on this device.")
    }}>Turn off</Button>}
    {message&&<p className="text-sm w-full" role="status">{message}</p>}
   </div>
   <Card><CardContent className="p-5 space-y-3"><h3 className="font-semibold text-lg">Your updates {alerts.filter(a=>!a.read).length>0?`(${alerts.filter(a=>!a.read).length} new)`:""}</h3>
   {alerts.length===0?<p className="text-sm opacity-70">No updates yet.</p>:alerts.slice(0,8).map(a=><div key={a.id} className="border-b pb-2 flex justify-between gap-2"><div><p className="font-semibold text-sm">{a.title}</p><p className="text-sm">{a.body}</p><p className="text-xs opacity-60">{new Date(a.createdAt).toLocaleString("en-GB")}</p></div>{!a.read&&<Button variant="outline" size="sm" onClick={async()=>{await api("/api/customer/alerts/"+a.id+"/read","POST");setAlerts(x=>x.map(y=>y.id===a.id?{...y,read:true}:y))}}>Read</Button>}</div>)}</CardContent></Card>
   <div className="rounded-2xl p-6 text-white space-y-2" style={{background:"#314d40"}}><p className="text-sm opacity-80">YOUR KITCHEN DASHBOARD</p><h2 className="text-2xl font-semibold">Hello, {me.orders[0]?.customerName?.split(" ")[0]||"there"}!</h2><p>Here’s your order journey and meal selections.</p></div>
   {me.selectionInvites.length>0&&<Card><CardContent className="p-5 space-y-3"><h3 className="text-lg font-semibold">Choose your meals</h3>{me.selectionInvites.filter(x=>x.status==="pending").map(x=><div key={x.token} className="border rounded-lg p-3 flex justify-between gap-2 items-center"><span>Selection for {new Date(x.weekFrom).toLocaleDateString("en-GB")}</span><a className="underline font-semibold" href={"/my/subscribe/"+encodeURIComponent(x.token)}>Choose meals →</a></div>)}<p className="text-xs text-muted-foreground">Selection uses your existing secure subscription link.</p></CardContent></Card>}
   <h3 className="text-lg font-semibold">Your deliveries</h3>
   {me.orders.length===0&&<p>No eligible orders found yet.</p>}
   {(["current","upcoming","past"] as const).map(group=><section key={group} className="space-y-3"><h4 className="font-semibold text-lg">{group==="current"?"Current deliveries":group==="upcoming"?"Coming up":"Past deliveries"}</h4>{me.orders.filter(o=>o.group===group).length===0?<p className="text-sm opacity-70">No {group} deliveries.</p>:null}{me.orders.filter(o=>o.group===group).map(o=><Card key={o.id}><CardContent className="p-5 space-y-3">
    <div className="flex justify-between gap-2 flex-wrap"><div><h4 className="font-semibold">Order #{o.wooId||o.id}</h4><p className="text-xs">Delivery {new Date(o.deliveryDate+"T12:00:00").toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long"})} · {o.fulfillmentType}</p></div><span className="rounded-full px-3 py-1 text-xs font-semibold self-start" style={{background:"#e6eee6"}}>{["cancelled","refunded"].includes(o.status)? "Cancelled":o.journey}</span></div>
    <ul className="text-sm space-y-1">{o.items.map((it,i)=><li key={i}>{it.quantity} × {it.name}</li>)}</ul>
    {o.deliveryAddress&&<p className="text-xs text-muted-foreground">Delivery: {o.deliveryAddress}</p>}
    {o.fulfillmentType==="delivery"&&!["cancelled","refunded"].includes(o.status)&&<DriverTracking orderId={o.id}/> }
    {editing===o.id?<div className="space-y-2"><label className="text-sm">Delivery instructions (e.g. gate code, safe location)</label><Textarea value={instructions} maxLength={1000} onChange={e=>setInstructions(e.target.value)}/><div className="flex gap-2"><Button onClick={async()=>{try{await api("/api/customer/orders/"+o.id+"/instructions","PATCH",{instructions});setEditing(null);await reload()}catch(e:any){setMessage(e.message)}}}>Save</Button><Button variant="outline" onClick={()=>setEditing(null)}>Cancel</Button></div>{message&&<p className="text-sm">{message}</p>}</div>:
    <div className="flex justify-between items-center gap-2"><p className="text-sm">Instructions: {o.instructions||"Not supplied"}</p>{o.canEditInstructions&&<Button size="sm" variant="outline" onClick={()=>{setMessage("");setEditing(o.id);setInstructions(o.instructions||"")}}>Edit</Button>}</div>}
   </CardContent></Card>)}</section>)}
  </>}
  <footer className="text-center text-xs opacity-70 py-5">Made with care by Simple Kitchen 🤎</footer>
 </div></div>
}
