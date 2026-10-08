import { sendDispatchTestPush } from "./customer-push";
import type { Express } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { createCustomerAlert } from "./customer-portal";
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
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_driver_logins (token_hash text PRIMARY KEY,driver_id bigint NOT NULL REFERENCES dispatch_drivers(id),expires_at timestamptz NOT NULL,used_at timestamptz)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_driver_sessions (token_hash text PRIMARY KEY,driver_id bigint NOT NULL REFERENCES dispatch_drivers(id),expires_at timestamptz NOT NULL)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_locations (driver_id bigint PRIMARY KEY REFERENCES dispatch_drivers(id),latitude double precision NOT NULL,longitude double precision NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),sharing boolean NOT NULL DEFAULT false)`);
 await pool.query(`CREATE TABLE IF NOT EXISTS dispatch_events (
  id bigserial PRIMARY KEY,order_id integer NOT NULL,driver_id bigint,kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now())`);
}
const digest=(token:string)=>crypto.createHash("sha256").update(token).digest("hex");
async function driverId(req:any):Promise<string|null>{
 const raw=(req.headers.cookie||"").split(";").map((v:string)=>v.trim()).find((v:string)=>v.startsWith("sk_driver="))?.slice(10);
 if(!raw)return null;
 const q=await pool.query("SELECT d.id::text FROM dispatch_driver_sessions s JOIN dispatch_drivers d ON d.id=s.driver_id WHERE s.token_hash=$1 AND s.expires_at>now() AND d.enabled=true",[digest(raw)]);
 return q.rows[0]?.id||null;
}
const driverOnly=async(req:any,res:any,next:any)=>{const id=await driverId(req);if(!id)return res.status(401).json({message:"Driver login required"});req.driverId=id;next()};
export function registerDispatch(app:Express){
 // Separate customer-independent email magic links. No driver receives admin credentials.
 app.post("/api/driver/access",async(req,res)=>{
  const email=String(req.body?.email||"").trim().toLowerCase();
  const generic={message:"If this is an authorised driver, a sign-in link will arrive shortly."};
  if(!/^\S+@\S+\.\S+$/.test(email))return res.json(generic);
  const driver=await pool.query("SELECT id FROM dispatch_drivers WHERE lower(email)=$1 AND enabled=true",[email]);
  if(!driver.rowCount)return res.json(generic);
  const count=await pool.query("SELECT count(*)::int AS n FROM dispatch_driver_logins WHERE driver_id=$1 AND expires_at>now()-interval '1 hour'",[driver.rows[0].id]);
  if(Number(count.rows[0].n)>=5)return res.json(generic);
  const raw=crypto.randomBytes(32).toString("base64url"),hash=digest(raw);
  const host=(await pool.query("SELECT value FROM settings WHERE key='smtp_host'")).rows[0]?.value||process.env.SMTP_HOST;
  const user=(await pool.query("SELECT value FROM settings WHERE key='smtp_user'")).rows[0]?.value||process.env.SMTP_USER;
  const pass=(await pool.query("SELECT value FROM settings WHERE key='smtp_pass'")).rows[0]?.value||process.env.SMTP_PASS;
  const port=Number((await pool.query("SELECT value FROM settings WHERE key='smtp_port'")).rows[0]?.value||587);
  const from=(await pool.query("SELECT value FROM settings WHERE key='smtp_from'")).rows[0]?.value||user;
  if(!host||!user||!pass)return res.status(503).json({message:"Driver email sign-in is not configured"});
  const publicBase=(process.env.DRIVER_PORTAL_URL||"").replace(/\/$/,"");
  if(!/^https:\/\//.test(publicBase))return res.status(503).json({message:"DRIVER_PORTAL_URL HTTPS origin required"});
  await pool.query("INSERT INTO dispatch_driver_logins(token_hash,driver_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')",[hash,driver.rows[0].id]);
  try{await nodemailer.createTransport({host,port,secure:port===465,auth:{user,pass}}).sendMail({
    from,to:email,subject:"Simple Kitchen — secure driver login",
    html:'<div style="font-family:Arial;background:#f4f1e9;padding:24px"><h2>Simple Kitchen Driver</h2><p>Your private sign-in link expires in 15 minutes.</p><a style="background:#314d40;color:white;padding:14px 20px;border-radius:8px" href="'+publicBase+'/driver?token='+encodeURIComponent(raw)+'">Sign in to your deliveries</a></div>'
  });res.json(generic)}catch{res.status(503).json({message:"Could not send driver sign-in email"})}
 });
 app.post("/api/driver/verify",async(req,res)=>{
  const raw=String(req.body?.token||"");if(raw.length<30)return res.sendStatus(400);
  const db=await pool.connect();try{await db.query("BEGIN");
    const q=await db.query("UPDATE dispatch_driver_logins SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING driver_id",[digest(raw)]);
    if(!q.rowCount){await db.query("ROLLBACK");return res.status(401).json({message:"Link invalid or expired"})}
    const session=crypto.randomBytes(32).toString("base64url");
    await db.query("INSERT INTO dispatch_driver_sessions(token_hash,driver_id,expires_at) VALUES($1,$2,now()+interval '14 days')",[digest(session),q.rows[0].driver_id]);
    await db.query("COMMIT");
    res.cookie("sk_driver",session,{httpOnly:true,secure:true,sameSite:"lax",maxAge:14*86400000,path:"/"});
    res.json({ok:true});
  }catch(e){await db.query("ROLLBACK");res.sendStatus(500)}finally{db.release()}
 });
 app.get("/api/driver/me",driverOnly,async(req:any,res)=>{
  const d=await pool.query('SELECT id::text,name,registration FROM dispatch_drivers WHERE id=$1',[req.driverId]);
  const stops=await pool.query(`SELECT a.order_id AS id,a.route_date AS "routeDate",a.delivery_day AS "day",a.sequence,a.state,
    o.customer_name AS "customerName",o.delivery_address AS address,
    (SELECT json_agg(json_build_object('name',i.product_name,'quantity',i.quantity)) FROM order_items i WHERE i.order_id=o.id) AS items
    FROM dispatch_assignments a JOIN orders o ON o.id=a.order_id
    WHERE a.driver_id=$1 AND a.route_date BETWEEN current_date-1 AND current_date+7
    ORDER BY a.route_date,a.sequence NULLS LAST,a.order_id`,[req.driverId]);
  res.setHeader("Cache-Control","no-store");res.json({driver:d.rows[0],stops:stops.rows});
 });
 app.post("/api/driver/orders/:id/state",driverOnly,async(req:any,res)=>{
  const state=String(req.body?.state||"");
  if(!["on_way","delivered","failed"].includes(state))return res.sendStatus(400);
  const testReplay=process.env.DISPATCH_TEST_MODE==="enabled" && state==="on_way";
  const q=await pool.query(`UPDATE dispatch_assignments SET state=$1,updated_at=now(),delivered_at=CASE WHEN $1='delivered' THEN now() ELSE delivered_at END
   WHERE order_id=$2 AND driver_id=$3 AND route_date BETWEEN current_date-1 AND current_date+7 AND ($4::boolean OR (state<>'delivered' AND ($1<>'on_way' OR state='assigned'))) RETURNING order_id,driver_id`,[state,req.params.id,req.driverId,testReplay]);
  if(!q.rowCount)return res.sendStatus(404);
  await pool.query("INSERT INTO dispatch_events(order_id,driver_id,kind) VALUES($1,$2,$3)",[req.params.id,req.driverId,state]);
  const sendNotice=async(id:number,kind:string)=>{
    if(process.env.DISPATCH_CUSTOMER_NOTIFICATIONS!=="enabled")return;
    const o=await pool.query("SELECT customer_email,woo_id FROM orders WHERE id=$1",[id]);
    const email=o.rows[0]?.customer_email;
    if(email)await createCustomerAlert(email,kind==="on_way"?"Your Simple Kitchen delivery is on its way!":"Your delivery is complete",
      kind==="on_way"?"Your driver is now heading to you. Open My Simple Kitchen to follow your delivery and see the latest updates.":"Your driver has marked your order delivered.",
      "dispatch:"+id+":"+kind+":"+new Date().toISOString().slice(0,10));
  };
  if(state==="on_way" && !testReplay)await sendNotice(Number(req.params.id),"on_way");
  // Test replay sends exclusively to the configured test recipient.
  let testPush:any=null;
  if(testReplay){
    const q=await pool.query("SELECT value FROM settings WHERE key='customer_portal_test_email'");
    const recipient=String(q.rows[0]?.value||"").trim().toLowerCase();
    if(recipient){
      try{testPush=await sendDispatchTestPush(recipient,"[TEST] Your Simple Kitchen delivery is on its way!","Your driver is now heading to you. Open My Simple Kitchen to follow your delivery.");}
      catch(e:any){testPush={error:e.message}}
    }else testPush={error:"Test email missing in customer portal settings"};
  }
  let nextStop:number|null=null;
  if(state==="delivered"){
    await sendNotice(Number(req.params.id),"delivered");
    const next=await pool.query(
      "SELECT a.order_id FROM dispatch_assignments a WHERE a.driver_id=$1 AND a.route_date=(SELECT route_date FROM dispatch_assignments WHERE order_id=$2 AND driver_id=$1 ORDER BY updated_at DESC LIMIT 1) AND a.delivery_day=(SELECT delivery_day FROM dispatch_assignments WHERE order_id=$2 AND driver_id=$1 ORDER BY updated_at DESC LIMIT 1) AND a.state='assigned' ORDER BY sequence NULLS LAST,order_id LIMIT 1",
      [req.driverId,req.params.id]);
    if(next.rowCount){
      nextStop=Number(next.rows[0].order_id);
      await pool.query("UPDATE dispatch_assignments SET state='on_way',updated_at=now() WHERE order_id=$1 AND driver_id=$2 AND state='assigned'",[nextStop,req.driverId]);
      await pool.query("INSERT INTO dispatch_events(order_id,driver_id,kind) VALUES($1,$2,'on_way')",[nextStop,req.driverId]);
      await sendNotice(nextStop,"on_way");
    }
  }
  res.json({ok:true,state,nextStop,testPush});
 });
 app.get("/api/driver/location-status",driverOnly,async(req:any,res)=>{
  const q=await pool.query('SELECT sharing,updated_at AS "updatedAt" FROM dispatch_locations WHERE driver_id=$1',[req.driverId]);
  res.setHeader("Cache-Control","no-store");
  res.json({sharing:q.rows[0]?.sharing===true,updatedAt:q.rows[0]?.updatedAt||null});
 });
 app.post("/api/driver/location",driverOnly,async(req:any,res)=>{
  const {lat,lng,sharing}=req.body||{};
  if(sharing===false){await pool.query("UPDATE dispatch_locations SET sharing=false,updated_at=now() WHERE driver_id=$1",[req.driverId]);return res.json({ok:true})}
  if(sharing!==true||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<49||lat>61||lng< -9||lng>3)return res.status(400).json({message:"Invalid coordinates"});
  await pool.query(`INSERT INTO dispatch_locations(driver_id,latitude,longitude,sharing,updated_at) VALUES($1,$2,$3,$4,now())
   ON CONFLICT(driver_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,sharing=EXCLUDED.sharing,updated_at=now()`,[req.driverId,lat,lng,sharing]);
  res.json({ok:true});
 });
 app.post("/api/driver/logout",driverOnly,async(req:any,res)=>{
  const raw=(req.headers.cookie||"").split(";").find((v:string)=>v.trim().startsWith("sk_driver="))?.trim().slice(10);
  if(raw)await pool.query("DELETE FROM dispatch_driver_sessions WHERE token_hash=$1",[digest(raw)]);
  res.clearCookie("sk_driver",{path:"/"});res.json({ok:true});
 });

 app.get("/api/driver/test-status",driverOnly,(_req,res)=>res.json({enabled:process.env.DISPATCH_TEST_MODE==="enabled"}));
 app.get("/api/dispatch/test-mode",onlyAdmin,(_req,res)=>{
   res.json({enabled:process.env.DISPATCH_TEST_MODE==="enabled",liveNotifications:process.env.DISPATCH_CUSTOMER_NOTIFICATIONS==="enabled"});
 });
 app.post("/api/dispatch/test-login",onlyAdmin,async(req,res)=>{
  if(process.env.DISPATCH_TEST_MODE!=="enabled")return res.status(403).json({message:"Dispatch test mode is disabled"});
  const driver=await pool.query("SELECT id FROM dispatch_drivers WHERE id=$1 AND enabled=true",[req.body?.driverId]);
  if(!driver.rowCount)return res.sendStatus(404);
  const token=crypto.randomBytes(32).toString("base64url");
  await pool.query("INSERT INTO dispatch_driver_sessions(token_hash,driver_id,expires_at) VALUES($1,$2,now()+interval '8 hours')",[digest(token),driver.rows[0].id]);
  res.cookie("sk_driver",token,{httpOnly:true,secure:true,sameSite:"lax",maxAge:8*3600000,path:"/"});
  res.json({ok:true,url:"/driver"});
 });
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
   const festiveNames=new Set(["garlic herb roast potatoes","potato dauphinoise","honey roasted carrots parsnips","cauliflower cheese","pigs in blankets","sage onion stuffing","maple bacon brussels sprouts","braised red cabbage apple","roasted dauphinoise potatoes","meat stuffing","honey pancetta roasted brussels","creamed leeks spinach"]);
   const festiveName=(name:string)=>festiveNames.has(name.toLowerCase().replace(/&amp;/g,"&").replace(/[^a-z0-9]+/g," ").trim());

   const included=orders.map(o=>{
     const list=rows.get(o.id)||[];
     const isFestiveBundle=list.filter(i=>festiveName(i.productName)).length>=2;
     return {...o,items:list.filter(i=>!(i.productId&&festiveIds.has(i.productId))&&!/\b(christmas|xmas)\b/i.test(i.productName)&&!(isFestiveBundle&&festiveName(i.productName)))};
   })
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
   const eligible=await pool.query("SELECT id FROM orders WHERE id=$1 AND is_tuesday=$2 AND lower(status) NOT IN ('cancelled','refunded','failed','trash')",[orderId,day==="tuesday"]);
   if(!eligible.rowCount)return res.status(400).json({message:"Inactive order or delivery day mismatch"});
   const items=await storage.getOrderItems(orderId);
   const festiveProducts=await storage.getProducts();
   const festiveIds=new Set(festiveProducts.filter(p=>/(^|\\W)(christmas|xmas)(\\W|$)/i.test(p.category||"")).map(p=>p.id));
   if(items.length===0||items.every(i=>!!(i.productId&&festiveIds.has(i.productId))||/\\b(christmas|xmas)\\b/i.test(i.productName)))
     return res.status(400).json({message:"Christmas-only or empty orders cannot be dispatched on regular routes"});
   const nextSequence=driverId===null?null:Number((await pool.query("SELECT COALESCE(MAX(sequence),0)+1 AS n FROM dispatch_assignments WHERE driver_id=$1 AND delivery_day=$2 AND route_date=$3",[driverId,day,routeDate])).rows[0].n);
   const q=await pool.query(`INSERT INTO dispatch_assignments(order_id,delivery_day,route_date,driver_id,state,sequence) VALUES($1,$2,$3,$4,'assigned',$5)
    ON CONFLICT(order_id,delivery_day,route_date) DO UPDATE SET driver_id=EXCLUDED.driver_id,sequence=CASE WHEN dispatch_assignments.driver_id IS NOT DISTINCT FROM EXCLUDED.driver_id THEN dispatch_assignments.sequence ELSE EXCLUDED.sequence END,state='assigned',updated_at=now()
    RETURNING order_id,driver_id::text`,[orderId,day,routeDate,driverId,nextSequence]);
   res.json(q.rows[0]);
  }catch(e:any){res.status(500).json({message:e.message})}
 });
}
