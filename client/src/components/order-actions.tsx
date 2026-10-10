import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
type Preview = {id:number;customerName:string;localStatus:string;wooId:number|null;wooStatus:string|null;refundable:number;refundEligible:boolean;subscriptionLinked:boolean;duplicateWooId:boolean;refundError:string|null};
export function OrderActions({orderId,onComplete}:{orderId:number;onComplete?:()=>void}) {
 const [open,setOpen]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[confirmation,setConfirmation]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[action,setAction]=useState<"cancel"|"refund_cancel">("cancel");
 const qc=useQueryClient();
 async function load(){
  setOpen(true);setBusy(true);setError("");setConfirmation("");setPreview(null);
  try {const res=await fetch("/api/order-actions/"+orderId,{credentials:"include"});const d=await res.json();if(!res.ok)throw Error(d.message||"Unable to load payment details");setPreview(d)}
  catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function submit(){
  if(confirmation!==String(orderId))return;
  setBusy(true);setError("");
  try{
   const res=await fetch("/api/order-actions/"+orderId,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,confirmation})});
   const d=await res.json();if(!res.ok)throw Error(d.message||"Action failed");
   await qc.invalidateQueries();setOpen(false);onComplete?.();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <><Button size="sm" variant="outline" onClick={load}>Refund / Cancel</Button>
 <Dialog open={open} onOpenChange={v=>{if(!busy)setOpen(v)}}>
 <DialogContent><DialogHeader><DialogTitle>Order #{orderId} · Refund / Cancel</DialogTitle><DialogDescription>Financial actions cannot be undone. Check the payment in WooCommerce before confirming.</DialogDescription></DialogHeader>
 {busy&&!preview?<p>Checking order and payment…</p>:null}
 {preview&&<div className="space-y-3 text-sm">
 <p><strong>{preview.customerName}</strong> · {preview.wooId?`WooCommerce #${preview.wooId}`:"Manual order"} · {preview.localStatus}</p>
 <p>Payment gateway status: {preview.wooStatus??"Not linked"} · Maximum potentially refundable: <strong>£{preview.refundable.toFixed(2)}</strong></p>
 {preview.refundError&&<p className="text-destructive">{preview.refundError}</p>}
 {preview.duplicateWooId&&<p className="text-destructive font-medium">More than one local order uses this WooCommerce ID. Please resolve the shared-order discrepancy before proceeding.</p>}
 {preview.subscriptionLinked&&<p className="text-destructive font-medium">Subscription-linked order: cancellation and refund are blocked pending manual review.</p>}
 <div className="flex gap-2 flex-wrap"><Button variant={action==="cancel"?"default":"outline"} onClick={()=>setAction("cancel")} disabled={busy}>Cancel without refund</Button><Button variant={action==="refund_cancel"?"destructive":"outline"} disabled={busy||!preview.refundEligible} onClick={()=>setAction("refund_cancel")}>Refund & Cancel</Button></div>
 <p>{action==="refund_cancel"?"This requests a full remaining refund through WooCommerce's payment gateway, then cancels the order.":"This cancels the order without sending any refund."}</p>
 <label className="block space-y-1"><span>Type order number <strong>{orderId}</strong> to confirm</span><Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder={String(orderId)}/></label>
 </div>}
 {error&&<p className="text-destructive text-sm">{error}</p>}
 <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setOpen(false)}>Close</Button><Button variant="destructive" disabled={busy||!preview||preview.subscriptionLinked||preview.duplicateWooId||confirmation!==String(orderId)||(action==="refund_cancel"&&!preview.refundEligible)||["cancelled","refunded"].includes(preview.localStatus)} onClick={submit}>{busy?"Working…":action==="refund_cancel"?"Confirm refund & cancel":"Confirm cancellation"}</Button></DialogFooter>
 </DialogContent></Dialog></>;
}
