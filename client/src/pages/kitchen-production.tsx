import { DebugExportButton } from "@/components/debug-export-button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, RefreshCcw, Printer } from "lucide-react";

type Detail = { orderId: number; wooId: number | null; customerName: string; quantity: number; isTuesday: boolean; status: string };
type Product = { productName: string; required: number; orders: Detail[] };
type Reconciliation = {productName:string;allRecorded:number;activeAllDays:number;selectedActive:number;inactive:number;otherDay:number;records:{orderId:number;wooId:number|null;customerName:string;quantity:number;status:string;day:string;included:boolean;reason:string}[]};
type Audit = {reconciliation:Reconciliation[]; generatedAt: string; day: string; ordersCount: number; products: Product[]; manualStock: {productName: string; quantity: number}[]; duplicates: unknown[] };
export default function KitchenProductionPage() {
  const dates = useDateFilter();
  const [day, setDay] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Record<string, string>>({});
  const qs = `?from=${encodeURIComponent(dates.from.toISOString())}&to=${encodeURIComponent(dates.to.toISOString())}&day=${day}`;
  const { data, isLoading, isError, refetch, isFetching } = useQuery<Audit>({ queryKey: ["/api/kitchen-audit", qs], refetchInterval:10000 });
  const [showAudit,setShowAudit] = useState(false);
  const [auditProduct,setAuditProduct] = useState<string|null>(null);
  const auditDifferences = (data?.reconciliation || []).filter(p=>p.allRecorded!==p.selectedActive);
  const total = data?.products.reduce((n,p)=>n+p.required,0) ?? 0;
  const mismatches = data?.products.filter(p => prepared[p.productName] !== undefined && prepared[p.productName] !== "" && Number(prepared[p.productName]) !== p.required).length ?? 0;
  return <div className="p-4 md:p-6 space-y-5">
    <div className="flex flex-wrap justify-between items-center gap-3">
      <div><h1 className="text-2xl font-semibold">Kitchen Production Check</h1><DateRangeLabel from={dates.from} to={dates.to}/></div>
      <div className="flex flex-wrap gap-2"><DateFilter {...dates} testIdPrefix="kitchen"/><DebugExportButton page="kitchen-production" from={dates.from} to={dates.to} day={day}/><Button variant="outline" onClick={()=>refetch()} disabled={isFetching}><RefreshCcw className="w-4 h-4 mr-2"/>Refresh</Button><Button variant="outline" onClick={()=>window.print()}><Printer className="w-4 h-4 mr-2"/>Print</Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Live order-by-order production reconciliation. Defaults to both delivery days to match the Orders page. Select Saturday or Tuesday for day-specific production. Christmas products are shown separately from regular meal preparation. Day selection applies to order allocations; manual/shop stock is displayed separately. Physical counts entered here are for checking only and are not saved.</p>
    <div className="flex gap-2 flex-wrap">{[["saturday","Saturday only"],["tuesday","Tuesday only"],["all","Both days"],["xmas","🎄 Christmas"]].map(([value,title])=><Button key={value} size="sm" variant={day===value?"default":"outline"} onClick={()=>{setDay(value);setPrepared({});}}>{title}</Button>)}</div>
    {isError && <p className="text-destructive">Couldn't load production data. Please refresh.</p>}
    {isLoading ? <p>Loading order allocations…</p> : data && <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-muted-foreground text-sm">Orders</div><strong className="text-2xl">{data.ordersCount}</strong></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-muted-foreground text-sm">Meals required</div><strong className="text-2xl">{total}</strong></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-muted-foreground text-sm">Count discrepancies</div><strong className="text-2xl">{mismatches}</strong></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-muted-foreground text-sm">Possible duplicate pairs</div><strong className="text-2xl">{data.duplicates.length}</strong></CardContent></Card>
      </div>
      <Card><CardHeader><CardTitle className="flex flex-wrap justify-between items-center gap-2"><span>Reconcile recorded orders</span><Button variant="outline" size="sm" onClick={()=>setShowAudit(v=>!v)}>{showAudit?"Hide breakdown":"Show missing / excluded orders"}</Button></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">The raw order total may differ from the kitchen requirement because of cancelled/refunded orders or a Saturday/Tuesday filter. These are explanations, not permission to ignore a customer order.</p>
          {auditDifferences.length>0?<p className="font-semibold text-amber-700">{auditDifferences.length} products have quantities excluded by status or delivery day.</p>:<p className="text-sm">No excluded quantities found for this selection. If Orders still disagrees, compare the date range, other filters and product names.</p>}
          {showAudit&&<div className="space-y-2">{(data.reconciliation||[]).map(p=><div key={p.productName} className="border rounded-lg p-3 space-y-2">
            <button className="w-full text-left flex justify-between gap-2 text-sm" onClick={()=>setAuditProduct(auditProduct===p.productName?null:p.productName)}><strong>{p.productName}</strong><span>Raw {p.allRecorded} · Active both days {p.activeAllDays} · Selected {p.selectedActive} <ChevronDown className="w-4 h-4 inline"/></span></button>
            {(p.inactive>0||p.otherDay>0)&&<p className="text-xs text-amber-700">Excluded: {p.inactive} cancelled/refunded/failed; {p.otherDay} on other delivery day</p>}
            {auditProduct===p.productName&&<div className="space-y-1 border-t pt-2">{p.records.map((o,i)=><div key={o.orderId+"-"+i} className="text-xs flex justify-between gap-2"><span>#{o.orderId}{o.wooId?" (Woo #"+o.wooId+")":""} · {o.customerName} · {o.day} · {o.status}</span><span className={o.included?"":"text-destructive"}>{o.quantity} — {o.reason}</span></div>)}</div>}
          </div>)}</div>}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Calculated: {new Date(data.generatedAt).toLocaleString("en-GB")}. All orders, including suspected duplicates, are included.</p>
      <Card><CardHeader><CardTitle>Required quantities and customer allocation</CardTitle></CardHeader><CardContent className="space-y-2">
        {data.products.length===0 && <p className="text-muted-foreground">No meals for this selection.</p>}
        {data.products.map(p=>{const entered=prepared[p.productName];const diff=entered!==undefined&&entered!==""?Number(entered)-p.required:null;return <div key={p.productName} className="border rounded-lg">
          <div className="flex gap-3 flex-wrap justify-between items-center p-3">
            <button className="flex gap-2 items-center text-left font-medium min-w-0 flex-1" onClick={()=>setExpanded(expanded===p.productName?null:p.productName)}>{expanded===p.productName?<ChevronDown className="w-4 h-4 shrink-0"/>:<ChevronRight className="w-4 h-4 shrink-0"/>}<span>{p.productName}</span></button>
            <span className="text-sm">Required: <strong className="text-lg">{p.required}</strong></span>
            <label className="flex items-center gap-2 text-sm">Prepared <Input aria-label={`Prepared ${p.productName}`} type="number" min={0} className="w-24" placeholder="Count" value={entered??""} onChange={e=>setPrepared(prev=>({...prev,[p.productName]:e.target.value}))}/></label>
            {diff!==null && <Badge variant={diff===0?"secondary":"destructive"}>{diff===0?"Matches":diff>0?`+${diff} extra`:`${Math.abs(diff)} short`}</Badge>}
          </div>
          {expanded===p.productName && <div className="border-t p-3 space-y-1 bg-muted/20">{p.orders.map((o,i)=><div key={i} className="text-sm flex justify-between gap-2"><span>{o.customerName} · order #{o.id}{o.wooId? ` / Woo #${o.wooId}`:""}{o.status!=="processing" ? ` · ${o.status}` : ""}</span><strong>{o.quantity}</strong></div>)}<div className="text-sm font-semibold border-t pt-2 flex justify-between"><span>Reconciled total</span><span>{p.orders.reduce((n,o)=>n+o.quantity,0)}</span></div></div>}
        </div>})}
      </CardContent></Card>
      {data.manualStock.length>0 && <Card><CardHeader><CardTitle>Manual/shop stock (not assigned to delivery day)</CardTitle></CardHeader><CardContent className="space-y-2">{data.manualStock.map((s,i)=><div key={i} className="flex justify-between text-sm"><span>{s.productName}</span><strong>{s.quantity}</strong></div>)}</CardContent></Card>}
    </>}
  </div>;
}
