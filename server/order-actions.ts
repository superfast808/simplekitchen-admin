import type { Express } from "express";
import { pool } from "./db";
import { storage } from "./storage";

const wcBase = (process.env.WC_STORE_URL || "").replace(/\/+$/, "");
function wooAuth() {
 const key=process.env.WC_CONSUMER_KEY, secret=process.env.WC_CONSUMER_SECRET;
 if (!wcBase || !key || !secret) throw new Error("WooCommerce credentials not configured");
 return "Basic " + Buffer.from(key+":"+secret).toString("base64");
}
async function wooRequest(path:string, method:"GET"|"PUT"|"POST", body?:unknown) {
 const res=await fetch(wcBase+"/wp-json/wc/v3/"+path,{method,headers:{Authorization:wooAuth(),"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
 const raw=await res.text();let json:any;try{json=JSON.parse(raw)}catch{json={message:raw.slice(0,500)}}
 if(!res.ok)throw new Error("WooCommerce "+res.status+": "+(json?.message||"Request failed"));
 return json;
}
export function registerOrderActions(app:Express) {
 app.get("/api/order-actions/:id",async(req,res)=>{
  if(!req.session?.userId)return res.status(401).json({message:"Unauthorized"});
  try {
   const id=Number(req.params.id);const order=await storage.getOrder(id);
   if(!order)return res.status(404).json({message:"Order not found"});
   const refs=await pool.query("SELECT id FROM subscription_invites WHERE order_id=$1 OR selections_order_id=$1 OR tuesday_selections_order_id=$1 LIMIT 1",[id]);
   const sharedWoo = order.wooId ? await pool.query("SELECT count(*)::int AS n FROM orders WHERE woo_id=$1",[order.wooId]) : null;
   const duplicateWooId = Number(sharedWoo?.rows[0]?.n||0)>1;
   const subscriptionLinked=refs.rowCount>0;
   let woo:any=null;let refundError:string|null=null;
   if(order.wooId){
    try {woo=await wooRequest("orders/"+order.wooId,"GET");}catch(e:any){refundError=e.message}
   }
   const refunds=woo?.id?await wooRequest("orders/"+woo.id+"/refunds","GET").catch(()=>[]):[];
   const refundable=woo ? Math.max(0,Math.round((Number(woo.total||0)- (Array.isArray(refunds)?refunds.reduce((n:number,r:any)=>n+Math.abs(Number(r.amount||0)),0):0))*100))/100 : 0;
   res.json({id:order.id,customerName:order.customerName,localStatus:order.status,wooId:order.wooId,wooStatus:woo?.status??null,refundEligible:!!woo && !subscriptionLinked && !duplicateWooId && refundable>0 && !["cancelled","refunded","failed","pending"].includes(woo.status),refundable,subscriptionLinked,duplicateWooId,refundError});
  }catch(e:any){res.status(502).json({message:e.message})}
 });
 app.post("/api/order-actions/:id",async(req,res)=>{
  if(!req.session?.userId)return res.status(401).json({message:"Unauthorized"});
  const id=Number(req.params.id), action=req.body?.action, confirmation=req.body?.confirmation;
  if(!Number.isSafeInteger(id)||id<1||!["cancel","refund_cancel"].includes(action)||confirmation!==String(id))return res.status(400).json({message:"Confirm the exact order number and action"});
  const client=await pool.connect();
  try {
   // Per-order advisory lock serialises admin actions, preventing duplicate refund clicks.
   await client.query("SELECT pg_advisory_lock($1)",[id]);
   const order=await storage.getOrder(id);
   if(!order)return res.status(404).json({message:"Order not found"});
   if(["cancelled","refunded"].includes(order.status))return res.status(409).json({message:"Order already cancelled or refunded"});
   const refs=await client.query("SELECT id FROM subscription_invites WHERE order_id=$1 OR selections_order_id=$1 OR tuesday_selections_order_id=$1 LIMIT 1",[id]);
   if(refs.rowCount)return res.status(409).json({message:"Subscription-linked orders need manual review; action blocked to protect subscription payment"});
   if(order.wooId){
    const duplicate=await client.query("SELECT COUNT(*)::int AS n FROM orders WHERE woo_id=$1",[order.wooId]);
    if(Number(duplicate.rows[0]?.n)>1)return res.status(409).json({message:"Multiple local orders share this WooCommerce ID. Review the duplicate records before changing the shared payment/order."});
   }
   if(!order.wooId && action==="refund_cancel")return res.status(400).json({message:"No WooCommerce payment associated with this order"});
   let refundId:number|null=null, refundAmount:number|null=null;
   if(order.wooId){
    const woo=await wooRequest("orders/"+order.wooId,"GET");
    if(action==="refund_cancel"){
     const refunds=await wooRequest("orders/"+woo.id+"/refunds","GET");
     const remaining=Math.round((Number(woo.total||0)-(Array.isArray(refunds)?refunds.reduce((n:number,r:any)=>n+Math.abs(Number(r.amount||0)),0):0))*100)/100;
     if(remaining<=0||["refunded","cancelled","failed","pending"].includes(woo.status))return res.status(409).json({message:"Order not eligible for refund"});
     // WooCommerce uses its configured gateway; don't mark the refund successful unless WC confirms it.
     const refund=await wooRequest("orders/"+woo.id+"/refunds","POST",{amount:remaining.toFixed(2),reason:"Cancelled by Simple Kitchen admin",api_refund:true});
     refundId=refund.id;refundAmount=remaining;
    }
    try{await wooRequest("orders/"+woo.id,"PUT",{status:"cancelled"})}
    catch(e:any){
     await client.query("INSERT INTO order_action_audit(order_id,actor_id,action,details) VALUES($1,$2,$3,$4)",[id,req.session.userId,"remote_cancel_failed",JSON.stringify({refundId,refundAmount,error:e.message})]);
     return res.status(502).json({message:"WooCommerce cancellation failed. "+(refundId?"Refund may already have succeeded. Do not retry; check WooCommerce refund #"+refundId+". ":"")+e.message});
    }
   }
   await storage.updateOrder(id,{status:"cancelled"});
   await client.query("INSERT INTO order_action_audit(order_id,actor_id,action,details) VALUES($1,$2,$3,$4)",[id,req.session.userId,action,JSON.stringify({wooId:order.wooId,refundId,refundAmount})]);
   res.json({success:true,refundId,refundAmount});
  }catch(e:any){res.status(502).json({message:e.message})}
  finally{await client.query("SELECT pg_advisory_unlock($1)",[id]).catch(()=>{});client.release()}
 });
}
