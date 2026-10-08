import { useQuery } from "@tanstack/react-query";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCcw, AlertTriangle } from "lucide-react";

type Order = { id: number; wooId: number | null; customerName: string; customerEmail: string | null; orderDate: string; status: string; isManual: boolean; isTuesday: boolean; items: {productName: string; quantity: number}[] };
type Group = {confidence:"high"|"possible"; reason:string; orders:Order[]};
type Result = {generatedAt:string; groups:Group[]; note:string};
export default function PossibleDuplicatesPage() {
 const dates=useDateFilter();
 const qs=`?from=${encodeURIComponent(dates.from.toISOString())}&to=${encodeURIComponent(dates.to.toISOString())}`;
 const {data,isLoading,isError,refetch,isFetching}=useQuery<Result>({queryKey:["/api/possible-duplicates",qs]});
 const high=data?.groups.filter(g=>g.confidence==="high").length??0;
 return <div className="p-4 md:p-6 space-y-5">
  <div className="flex flex-wrap gap-3 justify-between items-center"><div><h1 className="text-2xl font-semibold">Possible Duplicate Orders</h1><DateRangeLabel from={dates.from} to={dates.to}/></div><div className="flex gap-2 flex-wrap"><DateFilter {...dates} testIdPrefix="dupes"/><Button variant="outline" onClick={()=>refetch()} disabled={isFetching}><RefreshCcw className="w-4 h-4 mr-2"/>Refresh</Button></div></div>
  <div className="border rounded-lg p-4 flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0 text-amber-600"/><p className="text-sm"><strong>Review only — no automatic exclusion.</strong> All suspected duplicates remain in Product Totals, Ingredients and Kitchen Production. Check the customer, payment, delivery day and order source before cancelling anything. Two matching orders may both be genuine.</p></div>
  {isError&&<p className="text-destructive">Unable to check orders.</p>}
  {isLoading?<p>Checking orders…</p>:data&&<>
   <div className="flex gap-3 flex-wrap text-sm"><Badge variant="destructive">{high} high-confidence pairs</Badge><Badge variant="secondary">{data.groups.length-high} other possible pairs</Badge><span className="text-muted-foreground">Checked {new Date(data.generatedAt).toLocaleString("en-GB")}</span></div>
   {data.groups.length===0&&<Card><CardContent className="p-6">No closely matching orders found in this date range. This does not rule out missing orders or subscription allocation errors.</CardContent></Card>}
   {data.groups.map((g,i)=><Card key={i}><CardContent className="p-4 space-y-3">
    <div className="flex gap-2 items-center flex-wrap"><Badge variant={g.confidence==="high"?"destructive":"secondary"}>{g.confidence==="high"?"High confidence":"Possible"}</Badge><span className="text-sm">{g.reason}</span></div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{g.orders.map(o=><div key={o.id} className="border rounded-lg p-3 text-sm space-y-1"><p className="font-semibold">Order #{o.id}{o.wooId!=null?` · Woo #${o.wooId}`:""}</p><p>{o.customerName}{o.customerEmail?` · ${o.customerEmail}`:""}</p><p className="text-muted-foreground">{new Date(o.orderDate).toLocaleString("en-GB")} · {o.isTuesday?"Tuesday":"Saturday"} · {o.isManual?"Manual":"Online"} · {o.status}</p><ul className="list-disc pl-5">{o.items.map((item,j)=><li key={j}>{item.quantity} × {item.productName}</li>)}</ul></div>)}</div>
   </CardContent></Card>)}
  </>}
 </div>;
}
