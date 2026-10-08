import { useEffect,useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card,CardContent } from "@/components/ui/card";
import { Truck,MapPin,LogOut,CheckCircle,Navigation } from "lucide-react";
type Stop={id:number;customerName:string;address:string;day:string;routeDate:string;state:string;items:{name:string;quantity:number}[]};
type DriverData={driver:{id:string;name:string;registration:string|null};stops:Stop[]};
const request=async(path:string,method="GET",body?:unknown)=>{const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},credentials:"include",body:body?JSON.stringify(body):undefined,cache:"no-store"});const data=await response.json();if(!response.ok)throw Error(data.message||"Request failed");return data};
export default function DriverApp(){
 const [email,setEmail]=useState(""),[data,setData]=useState<DriverData|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[locationOn,setLocationOn]=useState(false),[install,setInstall]=useState<any>(null);
 const refresh=()=>request("/api/driver/me").then(setData).catch(()=>setData(null));
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),token=params.get("token");
  if(token){request("/api/driver/verify","POST",{token}).then(()=>{window.history.replaceState({},"","/driver");refresh()}).catch(e=>setMessage(e.message))}else refresh();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("/driver-sw.js",{scope:"/driver"}).catch(()=>{});
  const link=document.createElement("link");link.rel="manifest";link.href="/driver-manifest.webmanifest";document.head.appendChild(link);
  const handler=(e:any)=>{e.preventDefault();setInstall(e)};window.addEventListener("beforeinstallprompt",handler);
  return()=>{link.remove();window.removeEventListener("beforeinstallprompt",handler)};
 },[]);
 useEffect(()=>{
  if(!locationOn||!data||!("geolocation" in navigator))return;
  const id=navigator.geolocation.watchPosition(p=>{
   request("/api/driver/location","POST",{lat:p.coords.latitude,lng:p.coords.longitude,sharing:true}).catch(e=>setMessage(e.message));
  },()=>setMessage("Location permission is needed for live tracking"),{enableHighAccuracy:true,maximumAge:15000,timeout:15000});
  return()=>{navigator.geolocation.clearWatch(id)};
 },[locationOn,data?.driver.id]);
 const setState=async(orderId:number,state:string)=>{setBusy(true);try{await request("/api/driver/orders/"+orderId+"/state","POST",{state});await refresh();setMessage(state==="delivered"?"Delivery confirmed":state==="on_way"?"On your way recorded":"Delivery issue recorded")}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};
 const stopSharing=async()=>{setLocationOn(false);try{const p=await new Promise<GeolocationPosition>((ok,fail)=>navigator.geolocation.getCurrentPosition(ok,fail,{timeout:8000}));await request("/api/driver/location","POST",{lat:p.coords.latitude,lng:p.coords.longitude,sharing:false})}catch{}};
 return <div className="min-h-screen bg-[#f4f1e9] text-[#314d40] p-4 space-y-4"><header className="rounded-2xl bg-[#314d40] text-white p-5"><div className="flex items-center gap-3"><Truck/><div><h1 className="text-xl font-bold">Simple Kitchen Driver</h1><p className="text-xs opacity-75">Your deliveries, organised</p></div></div></header>
 {install&&<Button onClick={async()=>{await install.prompt();setInstall(null)}}>Install driver app</Button>}
 {!data?<Card><CardContent className="p-6 space-y-4"><h2 className="font-semibold">Driver sign in</h2><p className="text-sm">Use the email registered by the kitchen to receive a secure sign-in link.</p><form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await request("/api/driver/access","POST",{email});setMessage(r.message)}catch(e:any){setMessage(e.message)}finally{setBusy(false)}}}><Input type="email" required placeholder="Your email address" value={email} onChange={e=>setEmail(e.target.value)}/><Button className="w-full" disabled={busy}>Send secure link</Button></form></CardContent></Card>:
 <><div className="flex justify-between items-center gap-2"><div><strong>{data.driver.name}</strong><p className="text-xs">{data.driver.registration||"Driver"}</p></div><Button size="sm" variant="outline" onClick={async()=>{await stopSharing();await request("/api/driver/logout","POST");setData(null)}}><LogOut className="w-4 h-4 mr-2"/>Sign out</Button></div>
 <Card><CardContent className="p-4 space-y-2"><p className="font-semibold">Live location sharing</p><p className="text-xs">Location is shared only while enabled and an assigned delivery is on the way. Keeping this screen open improves updates; background tracking cannot be guaranteed by a web app.</p><Button variant={locationOn?"destructive":"outline"} onClick={()=>locationOn?stopSharing():setLocationOn(true)}><MapPin className="w-4 h-4 mr-2"/>{locationOn?"Stop location sharing":"Enable location sharing"}</Button></CardContent></Card>
 <div className="space-y-3"><h2 className="font-semibold">My assigned stops ({data.stops.length})</h2>{data.stops.map(s=><Card key={s.id}><CardContent className="p-4 space-y-3"><div className="flex justify-between gap-2"><div><strong>{s.customerName}</strong><p className="text-xs">{new Date(s.routeDate).toLocaleDateString("en-GB")} · {s.day} · #{s.id}</p></div><span className="text-xs capitalize">{s.state.replace("_"," ")}</span></div><p className="text-sm">{s.address}</p><p className="text-xs">{(s.items||[]).map(i=>i.quantity+"× "+i.name).join(" · ")}</p><div className="flex gap-2 flex-wrap"><Button variant="outline" onClick={()=>window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(s.address||""),"_blank")}><Navigation className="w-4 h-4 mr-1"/>Navigate</Button><Button disabled={busy||s.state==="delivered"} onClick={()=>setState(s.id,"on_way")}>On my way</Button><Button disabled={busy||s.state==="delivered"} onClick={()=>setState(s.id,"delivered")}><CheckCircle className="w-4 h-4 mr-1"/>Mark delivered</Button></div></CardContent></Card>)}</div>
 </>}
 {message&&<p className="rounded-lg bg-white border p-3 text-sm" role="status">{message}</p>}
 </div>
}