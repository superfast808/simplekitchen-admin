import { useEffect,useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card,CardContent } from "@/components/ui/card";
import { Truck,MapPin,LogOut,CheckCircle,Navigation } from "lucide-react";
type Stop={id:number;customerName:string;address:string;day:string;routeDate:string;state:string;items:{name:string;quantity:number}[]};
type DriverData={driver:{id:string;name:string;registration:string|null};stops:Stop[]};
const request=async(path:string,method="GET",body?:unknown)=>{const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},credentials:"include",body:body?JSON.stringify(body):undefined,cache:"no-store"});const data=await response.json();if(!response.ok)throw Error(data.message||"Request failed");return data};
export default function DriverApp(){
 const [testMode,setTestMode]=useState(false);
 const [pushReadiness,setPushReadiness]=useState<{testRecipientConfigured?:boolean;registeredDevices?:number;vapidConfigured?:boolean}|null>(null);
 const [email,setEmail]=useState(""),[data,setData]=useState<DriverData|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[locationOn,setLocationOn]=useState(false),[install,setInstall]=useState<any>(null);
 const refresh=()=>request("/api/driver/me").then(async v=>{setData(v);try{const loc=await request("/api/driver/location-status");setLocationOn(!!loc.sharing)}catch{}}).catch(()=>setData(null));
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search),token=params.get("token");
  fetch("/api/driver/test-status",{credentials:"include"}).then(r=>r.ok?r.json():{enabled:false}).then(v=>{setTestMode(!!v.enabled);setPushReadiness(v)}).catch(()=>{});
  if(token){request("/api/driver/verify","POST",{token}).then(()=>{window.history.replaceState({},"","/driver");refresh()}).catch(e=>setMessage(e.message))}else refresh();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("/driver-sw.js",{scope:"/driver"}).catch(()=>{});
  const link=document.createElement("link");link.rel="manifest";link.href="/driver-manifest.webmanifest";document.head.appendChild(link);
  const handler=(e:any)=>{e.preventDefault();setInstall(e)};window.addEventListener("beforeinstallprompt",handler);
  return()=>{link.remove();window.removeEventListener("beforeinstallprompt",handler)};
 },[]);
 useEffect(()=>{
  if(!locationOn||!data||!("geolocation" in navigator))return;
  const send=(p:GeolocationPosition)=>{
   request("/api/driver/location","POST",{lat:p.coords.latitude,lng:p.coords.longitude,sharing:true}).catch(e=>setMessage(e.message));
  };
  const failure=()=>setMessage("Location permission is needed for live tracking");
  const id=navigator.geolocation.watchPosition(send,failure,{enableHighAccuracy:true,maximumAge:15000,timeout:15000});
  const heartbeat=window.setInterval(()=>navigator.geolocation.getCurrentPosition(send,failure,{enableHighAccuracy:true,maximumAge:15000,timeout:15000}),45000);
  return()=>{navigator.geolocation.clearWatch(id);window.clearInterval(heartbeat)};
 },[locationOn,data?.driver.id]);
 const setState=async(orderId:number,state:string)=>{setBusy(true);try{const result=await request("/api/driver/orders/"+orderId+"/state","POST",{state});await refresh();setMessage(result.testPush?.error?"Dispatch saved; test push failed: "+result.testPush.error:result.testPush?.accepted?"Dispatch saved; test push accepted by "+result.testPush.accepted+" push service(s)":state==="delivered"?"Delivery confirmed":state==="on_way"?"On your way recorded (live customer alerts may be disabled)":"Delivery issue recorded")}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};
 const stopSharing=async()=>{setLocationOn(false);try{await request("/api/driver/location","POST",{sharing:false})}catch(e:any){setMessage(e.message)}};
 return <div className="min-h-screen bg-[#f4f1e9] text-[#314d40] p-4 space-y-4">
  <header className="rounded-2xl bg-[#314d40] text-white p-5 flex items-center gap-3">
   <Truck/><div><h1 className="text-xl font-bold">Simple Kitchen Driver</h1><p className="text-xs opacity-75">Your deliveries, organised</p></div>
  </header>
  {install&&<Button onClick={async()=>{await install.prompt();setInstall(null)}}>Install driver app</Button>}
  {data&&testMode&&pushReadiness&&<div className="rounded-xl border border-amber-300 bg-white p-3 text-xs space-y-1"><strong>Test push readiness</strong><p>Test email: {pushReadiness.testRecipientConfigured?"Configured":"Missing"} · Registered devices: {pushReadiness.registeredDevices??0} · VAPID: {pushReadiness.vapidConfigured?"Configured":"Missing"}</p><p className="text-muted-foreground">Push accepted by a service does not guarantee the phone displayed it. Check phone notification permissions.</p></div>}
  {!data?
   <Card><CardContent className="p-6 space-y-4"><h2 className="font-semibold">Driver sign in</h2>
    <p className="text-sm">Use the email registered by the kitchen to receive a secure sign-in link.</p>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const result=await request("/api/driver/access","POST",{email});setMessage(result.message)}catch(err:any){setMessage(err.message)}finally{setBusy(false)}}}>
     <Input type="email" required placeholder="Your email address" value={email} onChange={e=>setEmail(e.target.value)}/>
     <Button className="w-full" disabled={busy}>Send secure link</Button>
    </form>
   </CardContent></Card>:
   <>
    <div className="flex justify-between items-center gap-2">
     <div><strong>{data.driver.name}</strong><p className="text-xs">{data.driver.registration||"Driver"}</p></div>
     <Button size="sm" variant="outline" onClick={async()=>{await stopSharing();await request("/api/driver/logout","POST");setData(null)}}><LogOut className="w-4 h-4 mr-2"/>Sign out</Button>
    </div>
    <Card><CardContent className="p-4 space-y-2">
     <p className="font-semibold">Live location sharing</p>
     <p className="text-xs">Share your location only during deliveries. Keep the app open for reliable updates.</p>
     <Button variant={locationOn?"destructive":"outline"} onClick={()=>locationOn?stopSharing():setLocationOn(true)}>
      <MapPin className="w-4 h-4 mr-2"/>{locationOn?"Stop location sharing":"Enable location sharing"}
     </Button>
    </CardContent></Card>
    <h2 className="font-semibold">Assigned stops ({data.stops.length})</h2>
    {data.stops.map(stop=><Card key={stop.id}><CardContent className="p-4 space-y-3">
     <div className="flex justify-between gap-2"><div><strong>{stop.customerName}</strong><p className="text-xs">{new Date(stop.routeDate).toLocaleDateString("en-GB")} · {stop.day} · #{stop.id}</p></div><span className="text-xs capitalize">{stop.state.replace("_"," ")}</span></div>
     <p className="text-sm">{stop.address}</p>
     <p className="text-xs">{(stop.items||[]).map(item=>item.quantity+"× "+item.name).join(" · ")}</p>
     <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={()=>window.open("https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(stop.address||""),"_blank")}><Navigation className="w-4 h-4 mr-1"/>Navigate</Button>
      <Button disabled={busy||(!testMode&&stop.state!=="assigned")} onClick={()=>setState(stop.id,"on_way")}>{testMode&&stop.state!=="assigned"?"Replay On my way (TEST)":"On my way"}</Button>
      <Button disabled={busy||stop.state==="delivered"} onClick={()=>setState(stop.id,"delivered")}><CheckCircle className="w-4 h-4 mr-1"/>Mark delivered</Button>
     </div>
    </CardContent></Card>)}
   </>
  }
  {message&&<p className="rounded-lg bg-white border p-3 text-sm" role="status">{message}</p>}
 </div>;
}
