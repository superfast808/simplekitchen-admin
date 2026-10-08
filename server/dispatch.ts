import type { Express } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import crypto from "crypto";
const inactive=new Set(["cancelled","refunded","failed","trash"]);
const onlyAdmin=(req:any,res:any,next:any)=>req.session?.userId?next():res.status(401).json({message:"Admin authentication required"});
export async function setupDispatchTables(){
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_drivers (
   id bigserial PRIMARY KEY,name text NOT NULL,registration text,photo_url text,email text,
   enabled boolean NOT NULL DEFAULT true,created_at timestamptz NOT NULL DEFAULT now())`);
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_assignments (
   order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
   delivery_day text NOT NULL CHECK(delivery_day IN ('saturday','tuesday')),
   driver_id bigint REFERENCES dispatch_drivers(id) ON DELETE SET NULL,
   route_date date NOT NULL,sequence integer,
   state text NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','on_way','delivered','failed')),
   delivered_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),
   PRIMARY KEY(order_id,delivery_day,route_date))`);
 await pool.query(`CREATE INDEX IF NOT EXISTS dispatch_assignments_driver_idx ON dispatch_assignments(driver_id,route_date)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_events (
  id bigserial PRIMARY KEY,order_id integer NOT NULL,driver_id bigint,kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now())`);
}
export function registerDispatch(app:Express){
 app.get("/api/dispatch/drivers",onlyAdmin,async(_req,res)=>{try{res.json((await pool.query('SELECT id::text,name,registration,photo_url AS "photoUrl",email,enabled FROM dispatch_drivers ORDER BY name')).rows)}catch(e:any){res.status(500).json({message:e.message})}});
 app.post("/api/dispatch/drivers",onlyAdmin,async(req,res)=>{
  const {name,registration,photoUrl,email}=req.body||{};
  if(typeof name!=="string"||name.trim().length<2||name.length>120)return res.status(400).json({message:"Driver name required"});
  if(photoUrl && (typeof photoUrl!=="string"||!/^https:\/\//.test(photoUrl)||photoUrl.length>500))return res.status(400).json({message:"Photo must be an HTTPS URL"});
  if(email && (typeof email!=="string"||!/^\S+@\S+\.\S+$/.test(email)))return res.status(400).json({message:"Invalid email"});
  try{const q=await pool.query('INSERT INTO dispatch_drivers(name,registration,photo_url,email) VALUES($1,$2,$3,$4) RETURNING id::text,name,registration,photo_url AS "photoUrl",email,enabled',[name.trim(),String(registration||"").slice(0,24)||null,photoUrl||null,email?.toLowerCase()||null]);res.status(201).json(q.rows[0])}catch(e:any){res.status(500).json({message:e.message})}
 });
 app.patch("/api/dispatch/drivers/:id",onlyAdmin,async(req,res)=>{
  const {name,registration,photoUrl,email,enabled}=req.body||{};
  try{const q=await pool.query('UPDATE dispatch_drivers SET name=COALESCE($2,name),registration=$3,photo_url=$4,email=$5,enabled=COALESCE($6,enabled) WHERE id=$1 RETURNING id::text,name,registration,photo_url AS "photoUrl",email,enabled',[req.params.id,name||null,registration||null,photoUrl||null,email||null,typeof enabled==="boolean"?enabled:null]);if(!q.rowCount)return res.sendStatus(404);res.json(q.rows[0])}catch(e:any){res.status(500).json({message:e.message})}
 });
 app.get("/api/dispatch/board",onlyAdmin,async(req,res)=>{
  const day=req.query.day==="tuesday"?"tuesday":"saturday";
  const routeDate=String(req.query.date||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(routeDate))return res.status(400).json({message:"Select a route date"});
  try{
   const from=new Date(String(req.query.from||"")),to=new Date(String(req.query.to||""));
   if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime()))return res.status(400).json({message:"Invalid order window"});
   const orders=(await storage.getOrders(from,to)).filter(o=>!inactive.has((o.status||"").toLowerCase())&&o.isTuesday===(day==="tuesday"));
   const products=await storage.getProducts(), festiveIds=new Set(products.filter(p=>/(^|\W)(christmas|xmas)(\W|$)/i.test(p.category||"")).map(p=>p.id));
   const rows=await storage.getOrderItemsBatch(orders.map(o=>o.id));
   const included=orders.map(o=>({...o,items:(rows.get(o.id)||[]).filter(i=>!(i.productId&&festiveIds.has(i.productId))&&!/\b(christmas|xmas)\b/i.test(i.productName))}))
    .filter(o=>o.items.length&&!o.items.some(i=>/meal\s+subscription\s*-\s*\d+/i.test(i.productName)))
    .filter(o=>!o.items.every(i=>/add\s+delivery/i.test(i.productName)));
   const ids=included.map(o=>o.id);
   const assignments=ids.length?(await pool.query('SELECT order_id,driver_id::text,sequence,state,delivered_at FROM dispatch_assignments WHERE route_date=$1 AND delivery_day=$2 AND order_id=ANY($3::int[])',[routeDate,day,ids])).rows:[];
   const indexed=new Map(assignments.map(a=>[a.order_id,a]));
   res.setHeader("Cache-Control","no-store");
   res.json({day,routeDate,development:true,stops:included.map(o=>({id:o.id,wooId:o.wooId,customerName:o.customerName,
    fulfillment:o.fulfillmentType,address:o.deliveryAddress,items:o.items.map(i=>({name:i.productName,quantity:i.quantity})),
    driverId:indexed.get(o.id)?.driver_id||null,sequence:indexed.get(o.id)?.sequence||null,state:indexed.get(o.id)?.state||"unassigned"}))});
  }catch(e:any){res.status(500).json({message:e.message})}
 });
 app.post("/api/dispatch/assign",onlyAdmin,async(req,res)=>{
  const {orderId,driverId,day,routeDate}=req.body||{};
  if(!Number.isInteger(orderId)||!["saturday","tuesday"].includes(day)||!/^\d{4}-\d{2}-\d{2}$/.test(String(routeDate)))return res.status(400).json({message:"Invalid assignment"});
  try{
   if(driverId!==null){const found=await pool.query('SELECT id FROM dispatch_drivers WHERE id=$1 AND enabled=true',[driverId]);if(!found.rowCount)return res.status(400).json({message:"Driver not found or disabled"})}
   const q=await pool.query(`INSERT INTO dispatch_assignments(order_id,delivery_day,route_date,driver_id,state) VALUES($1,$2,$3,$4,'assigned')
    ON CONFLICT(order_id,delivery_day,route_date) DO UPDATE SET driver_id=EXCLUDED.driver_id,state='assigned',updated_at=now()
    RETURNING order_id,driver_id::text`,[orderId,day,routeDate,driverId]);
   res.json(q.rows[0]);
  }catch(e:any){res.status(500).json({message:e.message})}
 });
}
