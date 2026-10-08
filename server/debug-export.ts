import { buildIndependentDiagnostics } from "./independent-diagnostics";
import type { Express } from "express";
import { storage } from "./storage";

/** Consistent, read-only diagnostic snapshot for comparing all operational views. */
export function registerDebugExport(app:Express){
 app.get("/api/debug/export",async(req,res)=>{
  if(!req.session?.userId)return res.status(401).json({message:"Unauthorized"});
  const from=new Date(String(req.query.from||"")),to=new Date(String(req.query.to||""));
  if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<from||to.getTime()-from.getTime()>180*86400000)
   return res.status(400).json({message:"Select a valid date range up to 40 days"});
  const page=String(req.query.page||"unknown"),day=String(req.query.day||"all");
  try{
   const orders=await storage.getOrders(from,to);
   const itemsMap=await storage.getOrderItemsBatch(orders.map(o=>o.id));
   const products=await storage.getProducts();
   const byId=new Map(products.map(p=>[p.id,p]));
   const byName=new Map(products.map(p=>[p.name.trim().toLowerCase(),p]));
   const normalise=(s:string)=>s.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
   const rows=orders.flatMap(o=>(itemsMap.get(o.id)||[]).map(i=>{
     const product=(i.productId?byId.get(i.productId):undefined)||byName.get(i.productName.trim().toLowerCase());
     const christmas=/(^|\W)(xmas|christmas)(\W|$)/i.test(product?.category||"");
     const inactive=["cancelled","refunded","failed","trash"].includes((o.status||"").toLowerCase());
     const otherDay=day==="saturday"?o.isTuesday:day==="tuesday"?!o.isTuesday:false;
     return {orderId:o.id,wooId:o.wooId??null,customerRef:"customer-"+o.id,orderDate:o.orderDate,
      status:o.status,day:o.isTuesday?"tuesday":"saturday",manual:o.isManual,
      lineId:i.id,productId:i.productId,product:i.productName,category:product?.category||null,
      quantity:i.quantity,unitOrLinePrice:i.price,christmas,inactive,
      excludedReason:christmas&&day!=="xmas"?"christmas":!christmas&&day==="xmas"?"regular":inactive?"inactive":otherDay?"other-day":null};
   }));
   const bucket=(items:typeof rows)=>{
     const map=new Map<string,number>();
     for(const item of items)map.set(item.product,(map.get(item.product)||0)+item.quantity);
     return Object.fromEntries([...map.entries()].sort((a,b)=>a[0].localeCompare(b[0])));
   };
   const active=rows.filter(x=>!x.inactive&&!x.christmas);
   const selected=rows.filter(x=>x.excludedReason===null);
   const ordersById=new Map<number,typeof rows>();
   for(const row of rows){let list=ordersById.get(row.orderId)||[];list.push(row);ordersById.set(row.orderId,list)}
   const duplicateCandidates:{orderIds:number[];reason:string}[]=[];
   const groups=new Map<string,number[]>();
   for(const [id,items] of ordersById){
    const first=items[0];const fingerprint=[first.wooId||"",first.day,items.map(i=>normalise(i.product)+":"+i.quantity).sort().join("|")].join("~");
    if(first.wooId!=null){const found=groups.get(fingerprint)||[];found.push(id);groups.set(fingerprint,found)}
   }
   for(const ids of groups.values())if(ids.length>1)duplicateCandidates.push({orderIds:ids,reason:"Shared WooCommerce order number and matching items"});
   // Page-specific reconciliation context, alongside the common order-level snapshot.
   // These figures intentionally expose each calculation's inclusion criteria.
   const pageComparison={
     orders:bucket(rows.filter(x=>!x.christmas&&!x.inactive)),
     kitchenProduction:bucket(rows.filter(x=>!x.christmas&&!x.inactive&&(day==="all"||x.day===day))),
     ingredientSource:bucket(rows.filter(x=>!x.christmas&&!x.inactive)),
     excluded:rows.filter(x=>x.excludedReason!==null).map(x=>({orderId:x.orderId,wooId:x.wooId,product:x.product,quantity:x.quantity,reason:x.excludedReason})),
     duplicateExample:duplicateCandidates,
   };
   const independent=await buildIndependentDiagnostics(from,to,day);
   const sectionKey=page.startsWith("christmas-")?"christmas":page;
   const pageSection=(independent.sections as Record<string,unknown>)[sectionKey];
   if(!pageSection && page!=="full-reconciliation")return res.status(400).json({message:"Unknown debug page"});
   const payload={
    schemaVersion:2,exportedAt:new Date().toISOString(),page,filter:{from:from.toISOString(),to:to.toISOString(),day},
    privacy:"Customer names, email addresses, postal addresses, phone numbers and delivery notes omitted. Order identifiers and product quantities retained for tracing.",
    totals:{recorded:bucket(rows.filter(x=>!x.christmas)),active:bucket(active),selected:bucket(selected),
      christmas:bucket(rows.filter(x=>x.christmas))},
    statuses:Object.fromEntries([...new Set(rows.map(r=>r.status))].map(status=>[status,rows.filter(r=>r.status===status).length])),
    duplicates:duplicateCandidates,pageComparison,lines:rows,
    independentCalculation:page==="full-reconciliation"?independent:pageSection,
    reconciliation:independent.comparison,
    calculationScope:page==="full-reconciliation"?"All independent sections":sectionKey,
   };
   res.setHeader("Cache-Control","no-store");
   res.setHeader("Content-Type","application/json; charset=utf-8");
   res.setHeader("Content-Disposition",`attachment; filename="simple-kitchen-${page.replace(/[^a-z0-9-]/gi,"")}-debug-${from.toISOString().slice(0,10)}.json"`);
   res.json(payload);
  }catch(e:any){res.status(500).json({message:e.message})}
 });
}
