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
  const send=(p:GeolocationPosition)=>{
   request("/api/driver/location","POST",{lat:p.coords.latitude,lng:p.coords.longitude,sharing:true}).catch(e=>setMessage(e.message));
  };
  const failure=()=>setMessage("Location permission is needed for live tracking");
  const id=navigator.geolocation.watchPosition(send,failure,{enableHighAccuracy:true,maximumAge:15000,timeout:15000});
  const heartbeat=window.setInterval(()=>navigator.geolocation.getCurrentPosition(send,failure,{enableHighAccuracy:true,maximumAge:15000,timeout:15000}),45000);
  return()=>{navigator.geolocation.clearWatch(id);window.clearInterval(heartbeat)};
 },[locationOn,data?.driver.id]);
 const setState=async(orderId:number,state:string)=>{setBusy(true);try{await request("/api/driver/orders/"+orderId+"/state","POST",{state});await refresh();setMessage(state==="delivered"?"Delivery confirmed":state==="on_way"?"On your way recorded":"Delivery issue recorded")}catch(e:any){setMessage(e.message)}finally{setBusy(false)}};
 const stopSharing=async()=>{setLocationOn(false);try{await request("/api/driver/location","POST",{sharing:false})}catch(e:any){setMessage(e.message)}};}