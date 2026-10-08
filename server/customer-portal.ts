import type { Express, Request } from "express";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { pool } from "./db";
import { fulfilmentDate, fulfilmentGroup, customerJourney, ukDateString } from "./customer-fulfilment";

const hash=(s:string)=>crypto.createHash("sha256").update(s).digest("hex");
const normalize=(s:string)=>s.trim().toLowerCase();
const token=()=>crypto.randomBytes(32).toString("base64url");
const cookieName="sk_customer";
async function setting(k:string,fallback=""){const r=await pool.query("SELECT value FROM settings WHERE key=$1",[k]);return r.rows[0]?.value??fallback}
const escapeHtml=(v:string)=>v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export function customerEmailContent(kind:"login"|"welcome"|"order",details:{link:string;orderNumber?:string}){
 const link=escapeHtml(details.link);
 const titles={login:"Your kitchen account awaits",welcome:"Welcome to My Simple Kitchen",order:"We've received your order"};
 const bodies={login:"Your secure link is ready. See your upcoming deliveries, past favourites and meal selections.",
 welcome:"You now have a handy place to follow orders, see your meal history and manage upcoming selections.",
 order:"Thank you for choosing Simple Kitchen! Order #"+escapeHtml(details.orderNumber||"")+" is safely with us. Follow your upcoming delivery anytime."};
 const action=kind==="login"?"Sign in to my account":"See my order journey";
 const foot=kind==="login"?"Your sign-in link expires in 15 minutes and works once. If you didn't request it, ignore this email.":"No password required — sign in using your order email address.";
 return '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f1e9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#314d40">'+
 '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:auto;background:#fff;border-radius:16px;overflow:hidden"><tr><td style="padding:30px;background:#314d40;text-align:center;color:white"><strong style="font-size:27px;letter-spacing:.5px">Simple Kitchen</strong><div style="font-size:11px;letter-spacing:2px;margin-top:8px;color:#dfe9df">MADE WITH CARE</div></td></tr>'+
 '<tr><td style="padding:32px 28px"><h1 style="font-size:24px;line-height:1.3;margin:0 0 18px">'+titles[kind]+'</h1><p style="font-size:15px;line-height:1.8;color:#546a59">'+bodies[kind]+'</p>'+
 '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0"><tr><td style="background:#314d40;border-radius:8px;padding:15px 24px"><a href="'+link+'" style="color:white;text-decoration:none;font-size:15px;font-weight:bold">'+action+'</a></td></tr></table>'+
 '<p style="font-size:13px;line-height:1.6;color:#718276">'+foot+'</p></td></tr><tr><td style="text-align:center;padding:20px;background:#f4f1e9;font-size:12px;color:#718276">Fresh meals, thoughtfully prepared 🤎<br>Simple Kitchen</td></tr></table></body></html>';
}
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
export async function createCustomerAlert(email:string,title:string,body:string,key:string) {
 await pool.query("INSERT INTO customer_portal_alerts(email,title,body,event_key) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING",[email.trim().toLowerCase(),title,body,key]);
}
export function registerCustomerPortal(app:Express){
 app.get("/api/customer/alerts",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  const result=await pool.query(`SELECT a.id::text,a.title,a.body,a.created_at AS "createdAt",
    (r.alert_id IS NOT NULL) AS "read" FROM customer_portal_alerts a
    LEFT JOIN customer_portal_alert_reads r ON r.alert_id=a.id AND r.email=$1
    WHERE a.email=$1 ORDER BY a.id DESC LIMIT 50`,[email]);
  res.setHeader("Cache-Control","no-store");res.json(result.rows);
 });
 app.post("/api/customer/alerts/:id/read",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  await pool.query(`INSERT INTO customer_portal_alert_reads(alert_id,email)
    SELECT id,$2 FROM customer_portal_alerts WHERE id=$1 AND email=$2
    ON CONFLICT DO NOTHING`,[req.params.id,email]);res.json({ok:true});
 });

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
   await sendCustomerPortalNotification(email,"Your Simple Kitchen sign-in link",customerEmailContent("login",{link}),"login:"+hash(raw));
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
  const orders=data.rows.map((o:any)=>{
    const deliveryDate=fulfilmentDate(o.orderDate,o.isTuesday);
    return {...o,deliveryDate,group:fulfilmentGroup(deliveryDate),journey:customerJourney(deliveryDate),canEditInstructions:deliveryDate>ukDateString(new Date()) && !["cancelled","refunded","failed"].includes(o.status)};
  });
  res.json({email,orders,selectionInvites:invites.rows});
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
