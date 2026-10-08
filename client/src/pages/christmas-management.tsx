import { useMemo,useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
type Item={productName:string;quantity:number;price:string};
type Order={id:number;wooId:number|null;customerName:string;orderDate:string;fulfillmentType:string;deliveryAddress:string|null;customerDeliveryInstructions?:string|null;status:string;items:Item[];shippingTotal:string|null};
type Mode="orders"|"delivery"|"weekly"|"monthly";
const fmt=(v:number)=>"£"+v.toFixed(2);
const startYear=new Date().getFullYear();
function MondayWeek(d:string){const x=new Date(d+"T12:00:00Z"),n=(x.getUTCDay()+6)%7;x.setUTCDate(x.getUTCDate()-n);return x.toISOString().slice(0,10)}
export default function ChristmasManagement({mode}:{mode:Mode}){
 const [from,setFrom]=useState(startYear+"-09-01"),[to,setTo]=useState(startYear+"-12-31");
 const query=`?category=xmas&from=${encodeURIComponent(from+"T00:00:00Z")}&to=${encodeURIComponent(to+"T23:59:59Z")}`;
 const {data=[],isLoading,isError,refetch}=useQuery<Order[]>({queryKey:["/api/orders",query]});
 const orders=data.filter(o=>!["cancelled","refunded","failed","trash"].includes(o.status?.toLowerCase()));
 const items=orders.flatMap(o=>o.items.map(i=>({...i,customerName:o.customerName,orderId:o.id})));
 const totalItems=items.reduce((n,i)=>n+i.quantity,0);
 const revenue=items.reduce((n,i)=>n+Number(i.price||0),0);
 const grouped=useMemo(()=>{
  const m=new Map<string,{orders:Set<number>;qty:number;revenue:number;items:Record<string,number>}>();
  for(const o of orders){
   const key=mode==="monthly"?o.orderDate.slice(0,7):MondayWeek(o.orderDate.slice(0,10));
   const row=m.get(key)||{orders:new Set<number>(),qty:0,revenue:0,items:{}};
   row.orders.add(o.id);
   for(const i of o.items){row.qty+=i.quantity;row.revenue+=Number(i.price||0);row.items[i.productName]=(row.items[i.productName]||0)+i.quantity}
   m.set(key,row);
  }
  return [...m.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
 },[orders,mode]);
 const title={orders:"Christmas Orders",delivery:"Christmas Eve Delivery & Collection",weekly:"Christmas Weekly Totals",monthly:"Christmas Monthly Totals"}[mode];
 const printLabels=()=>window.open(`/api/orders/labels?from=${encodeURIComponent(from+"T00:00:00Z")}&to=${encodeURIComponent(to+"T23:59:59Z")}&mode=xmas`,"_blank");
 return <div className="p-4 md:p-6 space-y-5">
 <div className="flex flex-wrap justify-between items-center gap-3"><div><h1 className="text-2xl font-semibold">🎄 {title}</h1><p className="text-sm text-muted-foreground">Separate festive fulfilment · category: xmas</p></div><div className="flex flex-wrap gap-2 items-center"><Input aria-label="Start date" type="date" value={from} onChange={e=>setFrom(e.target.value)} className="w-40"/><Input aria-label="End date" type="date" value={to} onChange={e=>setTo(e.target.value)} className="w-40"/><Button variant="outline" onClick={()=>refetch()}>Refresh</Button><Button onClick={printLabels}>Print Xmas labels</Button></div></div>
 {isError&&<p className="text-destructive">Unable to load Christmas orders.</p>}
 {isLoading?<p>Loading Christmas orders…</p>:<>
 <div className="grid grid-cols-2 md:grid-cols-3 gap-3"><Card><CardContent className="p-4"><p className="text-muted-foreground text-sm">Orders</p><strong className="text-2xl">{orders.length}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-muted-foreground text-sm">Sides / units</p><strong className="text-2xl">{totalItems}</strong></CardContent></Card><Card><CardContent className="p-4"><p className="text-muted-foreground text-sm">Christmas item sales</p><strong className="text-2xl">{fmt(revenue)}</strong></CardContent></Card></div>
 {(mode==="weekly"||mode==="monthly")?<div className="space-y-3">{grouped.map(([period,g])=><Card key={period}><CardHeader><CardTitle>{period} · {g.orders.size} orders · {g.qty} units · {fmt(g.revenue)}</CardTitle></CardHeader><CardContent className="grid gap-2 md:grid-cols-2">{Object.entries(g.items).sort((a,b)=>b[1]-a[1]).map(([name,qty])=><div key={name} className="text-sm border-b py-1 flex justify-between gap-3"><span>{name}</span><strong>{qty}</strong></div>)}</CardContent></Card>)}</div>:
 <div className="space-y-3">{orders.filter(o=>mode!=="delivery"||["delivery","collection"].includes((o.fulfillmentType||"").toLowerCase())).map(o=><Card key={o.id}><CardContent className="p-4 space-y-2"><div className="flex items-center justify-between flex-wrap gap-2"><h3 className="font-semibold">{o.customerName} · #{o.wooId||o.id}</h3><Badge variant="secondary">{o.fulfillmentType||"Collection"}</Badge></div>{mode==="delivery"&&<p className="text-sm">{o.deliveryAddress||"Collection"}{o.customerDeliveryInstructions?" · "+o.customerDeliveryInstructions:""}</p>}<p className="text-xs text-muted-foreground">Ordered: {new Date(o.orderDate).toLocaleDateString("en-GB")}</p>{o.items.map((it,i)=><div key={i} className="text-sm flex justify-between gap-3 border-b py-1"><span>{it.productName}</span><strong>{it.quantity} ×</strong></div>)}</CardContent></Card>)}</div>}
 </>}
 </div>;
}
