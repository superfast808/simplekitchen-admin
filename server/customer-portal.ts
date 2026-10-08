import type { Express, Request } from "express";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { pool } from "./db";

const hash=(s:string)=>crypto.createHash("sha256").update(s).digest("hex");
const normalize=(s:string)=>s.trim().toLowerCase();
const token=()=>crypto.randomBytes(32).toString("base64url");
const cookieName="sk_customer";
async function setting(k:string,fallback=""){const r=await pool.query("SELECT value FROM settings WHERE key=$1",[k]);return r.rows[0]?.value??fallback}
export async function sendCustomerPortalNotification(email:string,subject:string,html:string,eventKey:string){
 const enabled=await setting("customer_portal_live","false");
 const alias=await setting("customer_portal_test_email");
 const testMode=enabled!=="true";
 const recipient=testMode?alias:email;
 if(!recipient || !/^\S+@\S+\.\S+$/.test(recipient))return false;
 const existing=await pool.query("INSERT INTO customer_portal_notifications(email,event_key,status) VALUES($1,$2,'pending') ON CONFLICT(event_key) DO NOTHING RETURNING id",[email,eventKey]);
 if(!existing.rowCount)return false;
 try{
  const host=await setting("smtp_host",process.env.SMTP_HOST||"");
  const port=Number(await setting("smtp_port",process.env.SMTP_PORT||"587"));
  const user=await setting("smtp_user",process.env.SMTP_USER||"");
  const pass=await setting("smtp_pass",process.env.SMTP_PASS||"");
  const from=await setting("smtp_from",process.env.SMTP_FROM_EMAIL||user);
  if(!host||!user||!pass)throw Error("SMTP not configured");
  const transporter=nodemailer.createTransport({host,port,secure:port===465,auth:{user,pass}});
  await transporter.sendMail({from,to:recipient,subject:testMode?"[TEST for "+email+"] "+subject:subject,html});
  await pool.query("UPDATE customer_portal_notifications SET status='sent',delivered_to=$2 WHERE id=$1",[existing.rows[0].id,recipient]);
  return true;
 }catch(e:any){
  await pool.query("UPDATE customer_portal_notifications SET status='failed' WHERE id=$1",[existing.rows[0].id]);
  console.error("Customer notification failed",e.message);
  return false;
 }
}
async function eligible(email:string){
 const r=await pool.query(`SELECT 1 FROM orders o WHERE lower(o.customer_email)=$1 AND o.is_manual=false
 AND NOT EXISTS (SELECT 1 FROM order_items i JOIN products p ON p.id=i.product_id WHERE i.order_id=o.id AND lower(coalesce(p.category,'')) IN ('shop','wholesale','custom')) LIMIT 1`,[email]);
 return !!r.rowCount;
}
async function sessionEmail(req:Request) {
 const raw=(req.cookies as any)?.[cookieName] ?? (req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(cookieName+"="))?.slice(cookieName.length+1);
 if(!raw||typeof raw!=="string")return null;
 const r=await pool.query("SELECT email FROM customer_portal_sessions WHERE token_hash=$1 AND expires_at>now()",[hash(raw)]);
 return r.rows[0]?.email as string|null;
}
export function registerCustomerPortal(app:Express){
 app.post("/api/customer/access",async(req,res)=>{
  const email=normalize(String(req.body?.email||""));
  if(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return res.status(400).json({message:"Enter a valid email address"});
  const recent=await pool.query("SELECT count(*)::int AS n FROM customer_magic_links WHERE email=$1 AND created_at>now()-interval '1 hour'",[email]);
  const volume=await pool.query("SELECT count(*)::int AS n FROM customer_magic_links WHERE created_at>now()-interval '1 minute'");
  if(Number(recent.rows[0].n)>=5||Number(volume.rows[0].n)>100)return res.status(429).json({message:"Please try later"});
  // In test mode, only authenticated portal administrators can generate
  // impersonation links redirected to the test alias. Never expose this publicly.
  if((await setting("customer_portal_live","false"))!=="true" && !req.session?.userId){
    return res.json({message:"If an eligible account exists, a sign-in link has been sent."});
  }
  if(await eligible(email)){
   const raw=token();
   await pool.query("INSERT INTO customer_magic_links(token_hash,email,expires_at) VALUES($1,$2,now()+interval '15 minutes')",[hash(raw),email]);
   const url=(await setting("customer_portal_url","https://admin.simplekitchenprep.com/my")).replace(/\/$/,"");
   const link=url+"?token="+encodeURIComponent(raw);
   await sendCustomerPortalNotification(email,"Sign in to My Simple Kitchen",`<div style="font-family:Arial,sans-serif;max-width:540px;margin:auto;padding:24px"><h1 style="color:#314D40">My Simple Kitchen</h1><p>Your secure sign-in link is ready. It expires in 15 minutes.</p><p><a href="${link}" style="background:#314D40;color:white;padding:14px 20px;border-radius:8px;text-decoration:none">View my orders</a></p><p>If you didn't request this, you can ignore this email.</p></div>`,"login:"+hash(raw));
  }
  res.json({message:"If an eligible account exists, a sign-in link has been sent."});
 });
 app.post("/api/customer/verify",async(req,res)=>{
  const raw=String(req.body?.token||"");
  if(raw.length<32||raw.length>128)return res.status(400).json({message:"Invalid sign-in link"});
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const r=await client.query("UPDATE customer_magic_links SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING email",[hash(raw)]);
   if(!r.rowCount){await client.query("ROLLBACK");return res.status(401).json({message:"This link has expired or was already used"})}
   const value=token();
   await client.query("INSERT INTO customer_portal_sessions(token_hash,email,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(value),r.rows[0].email]);
   await client.query("COMMIT");
   res.cookie(cookieName,value,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:604800000});
   res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");res.status(500).json({message:"Unable to verify link"})}finally{client.release()}
 });
 app.get("/api/customer/me",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  const data=await pool.query(`SELECT o.id,o.woo_id AS "wooId",o.order_date AS "orderDate",o.status,o.is_tuesday AS "isTuesday",o.fulfillment_type AS "fulfillmentType",
  o.customer_delivery_instructions AS "instructions",o.customer_name AS "customerName",o.delivery_address AS "deliveryAddress",
  COALESCE(json_agg(json_build_object('name',i.product_name,'quantity',i.quantity)) FILTER(WHERE i.id IS NOT NULL),'[]') AS items
  FROM orders o LEFT JOIN order_items i ON i.order_id=o.id
  WHERE lower(o.customer_email)=$1 AND o.is_manual=false
  AND NOT EXISTS (SELECT 1 FROM order_items x JOIN products p ON p.id=x.product_id WHERE x.order_id=o.id AND lower(coalesce(p.category,'')) IN ('shop','wholesale','custom'))
  GROUP BY o.id ORDER BY o.order_date DESC LIMIT 100`,[email]);
  const invites=await pool.query(`SELECT si.token,si.week_from AS "weekFrom",si.week_to AS "weekTo",si.status FROM subscription_invites si WHERE lower(si.customer_email)=$1 AND si.status NOT IN ('cancelled','expired') ORDER BY si.week_from DESC LIMIT 10`,[email]);
  res.setHeader("Cache-Control","no-store");
  res.json({email,orders:data.rows,selectionInvites:invites.rows});
 });
 app.patch("/api/customer/orders/:id/instructions",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  const id=Number(req.params.id),instructions=String(req.body?.instructions??"").trim();
  if(!Number.isSafeInteger(id)||id<1||instructions.length>1000)return res.status(400).json({message:"Invalid delivery instructions"});
  const r=await pool.query(`UPDATE orders SET customer_delivery_instructions=$1 WHERE id=$2 AND lower(customer_email)=$3 AND is_manual=false
    AND status IN ('processing','on-hold','pending')
    AND ((date_trunc('week', (order_date AT TIME ZONE 'Europe/London') + interval '2 days') - interval '2 days')::date +
       CASE WHEN is_tuesday THEN 10 ELSE 7 END) > (now() AT TIME ZONE 'Europe/London')::date
    RETURNING id`,[instructions,id,email]);
  if(!r.rowCount)return res.status(403).json({message:"Instructions can't be changed for this order"});
  res.json({ok:true});
 });
 app.post("/api/customer/logout",async(req,res)=>{
  const raw=(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith(cookieName+"="))?.slice(cookieName.length+1);
  if(raw)await pool.query("DELETE FROM customer_portal_sessions WHERE token_hash=$1",[hash(raw)]);
  res.clearCookie(cookieName,{path:"/"});res.json({ok:true});
 });
 app.get("/api/customer-admin/config",async(req,res)=>{
  if(!req.session?.userId)return res.status(401).json({message:"Unauthorized"});
  res.json({live:(await setting("customer_portal_live","false"))==="true",testEmail:await setting("customer_portal_test_email"),url:await setting("customer_portal_url","https://admin.simplekitchenprep.com/my")});
 });
 app.post("/api/customer-admin/config",async(req,res)=>{
  if(!req.session?.userId)return res.status(401).json({message:"Unauthorized"});
  const {live,testEmail,url}=req.body||{};
  if(typeof live!=="boolean"||typeof testEmail!=="string"||typeof url!=="string")return res.status(400).json({message:"Invalid settings"});
  if(testEmail&&!/^\S+@\S+\.\S+$/.test(testEmail))return res.status(400).json({message:"Invalid test email"});
  try{const parsed=new URL(url);if(parsed.protocol!=="https:")throw Error("HTTPS required")}catch{return res.status(400).json({message:"Invalid portal URL"})}
  for(const [k,v] of [["customer_portal_live",String(live)],["customer_portal_test_email",testEmail],["customer_portal_url",url]]){
   await pool.query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[k,v]);
  }
  res.json({ok:true});
 });
}
