import type { Express, Request } from "express";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { pool } from "./db";
import { pushPublicKey,sendPush,pushConfigurationStatus } from "./customer-push";
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
 const saved=await pool.query("INSERT INTO customer_portal_alerts(email,title,body,event_key) VALUES($1,$2,$3,$4) ON CONFLICT(event_key) DO NOTHING RETURNING id",[email.trim().toLowerCase(),title,body,key]);
 if(saved.rowCount)sendPush(email,title,body).catch(e=>console.error("Push notification delivery failed",e));
}

const INTEREST_REPLY = "Thanks so much for your interest! We've saved your details and My Simple Kitchen will be ready soon. Keep an eye on your inbox. 🤎";
const INTEREST_LOGO_URL = "https://simplekitchenprep.com/wp-content/uploads/2026/04/logonormal.png";

function interestThankYouHtml() {
 return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
 <body style="margin:0;padding:24px 12px;background:#f4f1e9;color:#314d40;font-family:Arial,Helvetica,sans-serif">
 <div style="display:none;font-size:1px;color:#f4f1e9;line-height:1px;max-height:0;opacity:0;overflow:hidden">A little thank you from Simple Kitchen — something lovely is coming soon.</div>
 <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden">
 <tr><td align="center" style="background:#314d40;padding:28px 25px"><img src="${INTEREST_LOGO_URL}" alt="Simple Kitchen" width="190" style="display:block;max-width:100%;height:auto;border:0;color:#ffffff;font-size:22px;font-weight:bold"><div style="padding-top:14px;color:#e4e9df;font-size:11px;letter-spacing:2px">FRESHLY PREPARED WITH LOVE</div></td></tr>
 <tr><td style="padding:36px 32px 24px">
 <div style="font-size:13px;font-weight:bold;letter-spacing:1.8px;color:#78917b">MY SIMPLE KITCHEN</div>
 <h1 style="font-size:27px;line-height:1.3;margin:12px 0 22px;color:#314d40">Thanks for your interest! 🤎</h1>
 <p style="font-size:16px;line-height:1.8;margin:0 0 18px;color:#526759">Hello!</p>
 <p style="font-size:16px;line-height:1.8;margin:0 0 18px;color:#526759">Thank you so much for registering your interest in <strong>My Simple Kitchen</strong>. We're working on a lovely little space to make keeping up with your orders and favourite meals even easier.</p>
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;background:#f4f1e9;border-radius:12px"><tr><td style="padding:22px 24px;color:#314d40;font-size:16px;line-height:1.7"><strong>It's coming soon!</strong><div style="padding-top:6px;font-size:14px;color:#607565">We'll let you know when it's ready, so there's nothing more you need to do.</div></td></tr></table>
 <p style="font-size:16px;line-height:1.8;margin:0 0 22px;color:#526759">Thanks for being part of Simple Kitchen. We can't wait to share it with you!</p>
 <p style="font-size:16px;line-height:1.7;margin:0;color:#314d40">With love,<br><strong>Si &amp; Katy</strong><br>Simple Kitchen</p>
 </td></tr>
 <tr><td align="center" style="padding:22px 30px;background:#f4f1e9;color:#708075;font-size:12px;line-height:1.7">Fresh meals, thoughtfully prepared 🤎<br><span style="font-size:11px">You're receiving this because your email address was used to register interest in My Simple Kitchen. If that wasn't you, no action is needed.</span></td></tr>
 </table></body></html>`;
}

async function registerInterest(email:string,req:Request):Promise<boolean>{
 // No public access to real account data, sign-in tokens or test aliases.
 // A hashed IP and a unique email keep the acknowledgement form from becoming a mail relay.
 const ipHash=hash((process.env.SESSION_SECRET||"simple-kitchen")+"|"+(req.ip||"unknown"));
 const limits=await pool.query(`SELECT
   (SELECT count(*)::int FROM customer_portal_interest WHERE ip_hash=$1 AND created_at>now()-interval '1 hour') AS per_ip,
   (SELECT count(*)::int FROM customer_portal_interest WHERE created_at>now()-interval '1 minute') AS global_minute`,[ipHash]);
 if(Number(limits.rows[0]?.per_ip)>=8 || Number(limits.rows[0]?.global_minute)>=60)return false;
 // First registration sends once. If SMTP fails, a fresh request after 30 minutes retries only unsent mail.
 const inserted=await pool.query(`INSERT INTO customer_portal_interest(email,ip_hash) VALUES($1,$2)
 ON CONFLICT(email) DO UPDATE SET last_attempt_at=now()
 WHERE (customer_portal_interest.customer_sent_at IS NULL OR customer_portal_interest.owner_sent_at IS NULL)
   AND customer_portal_interest.last_attempt_at < now()-interval '30 minutes'
 RETURNING customer_sent_at,owner_sent_at`,[email,ipHash]);
 if(!inserted.rowCount)return true;
 try{
  const host=await setting("smtp_host",process.env.SMTP_HOST||"");
  const port=Number(await setting("smtp_port",process.env.SMTP_PORT||"587"));
  const user=await setting("smtp_user",process.env.SMTP_USER||"");
  const pass=await setting("smtp_pass",process.env.SMTP_PASS||"");
  const from=(await setting("smtp_from",process.env.SMTP_FROM_EMAIL||user))||user;
  if(!host||!user||!pass)throw Error("SMTP not configured");
  const transporter=nodemailer.createTransport({host,port,secure:port===465,auth:{user,pass}});
  if(!inserted.rows[0].customer_sent_at){
   try{
    await transporter.sendMail({from,to:email,subject:"Thanks for your interest in My Simple Kitchen 🤎",html:interestThankYouHtml(),text:"Hello!\n\nThank you so much for registering your interest in My Simple Kitchen. We're putting the finishing touches on your new space for orders and favourite meals. It'll be ready soon and we'll let you know when it's available.\n\nWith love,\nSi & Katy\nSimple Kitchen\n\nIf you didn't request this, no action is needed."});
    await pool.query("UPDATE customer_portal_interest SET customer_sent_at=now() WHERE email=$1",[email]);
   }catch(error){console.error("Customer interest thank-you failed",error);}
  }
  const owner=(await setting("customer_portal_test_email"))||user;
  if(owner && !inserted.rows[0].owner_sent_at){
   try{
    await transporter.sendMail({from,to:owner,subject:"My Simple Kitchen — new feature interest",text:"A visitor has registered interest in My Simple Kitchen: "+email,html:'<p>A visitor has registered interest in <strong>My Simple Kitchen</strong>:</p><p>'+escapeHtml(email)+'</p>'});
    await pool.query("UPDATE customer_portal_interest SET owner_sent_at=now() WHERE email=$1",[email]);
   }catch(error){console.error("Customer interest owner notification failed",error);}
  }
 }catch(error){console.error("Customer interest email setup failed",error);}
 return true;
}

export function registerCustomerPortal(app:Express){
 app.get("/api/customer/public-status",async(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  res.json({live:(await setting("customer_portal_live","false"))==="true"});
 });
 app.get("/api/customer/tracking/:orderId",async(req,res)=>{
  const email=await sessionEmail(req);
  if(!email)return res.status(401).json({message:"Not signed in"});
  const orderId=Number(req.params.orderId);
  if(!Number.isInteger(orderId))return res.sendStatus(400);
  const q=await pool.query(
    'SELECT a.state,d.name AS "driverName",l.latitude AS lat,l.longitude AS lng,l.updated_at AS "updatedAt",l.sharing,o.delivery_lat AS "destinationLat",o.delivery_lng AS "destinationLng" FROM orders o JOIN dispatch_assignments a ON a.order_id=o.id JOIN dispatch_drivers d ON d.id=a.driver_id LEFT JOIN dispatch_locations l ON l.driver_id=d.id WHERE o.id=$1 AND lower(o.customer_email)=$2 AND a.route_date BETWEEN current_date-1 AND current_date+7 ORDER BY a.updated_at DESC LIMIT 1',
    [orderId,email]);
  res.setHeader("Cache-Control","no-store");
  const item=q.rows[0];
  if(!item)return res.json({available:false});
  const visible=process.env.DISPATCH_CUSTOMER_TRACKING==="enabled"&&item.state==="on_way"&&item.sharing&&item.updatedAt&&Date.now()-new Date(item.updatedAt).getTime()<120000;
  let etaMinutes:number|null=null,roadKm:number|null=null;
  if(visible&&Number.isFinite(Number(item.destinationLat))&&Number.isFinite(Number(item.destinationLng))){
    try {
      const url="https://router.project-osrm.org/route/v1/driving/"+Number(item.lng)+","+Number(item.lat)+";"+Number(item.destinationLng)+","+Number(item.destinationLat)+"?overview=false";
      const response=await fetch(url,{signal:AbortSignal.timeout(4500)});
      if(response.ok){const body:any=await response.json();const first=body.routes?.[0];if(first){etaMinutes=Math.max(1,Math.round(first.duration/60));roadKm=Math.round(first.distance/100)/10}}
    }catch{ /* GPS position remains available when road routing provider cannot respond. */ }
  }
  res.json({available:true,state:item.state,driverName:item.driverName,trackingEnabled:process.env.DISPATCH_CUSTOMER_TRACKING==="enabled",
    location:visible?{lat:item.lat,lng:item.lng,updatedAt:item.updatedAt}:null,
    etaMinutes,roadKm,etaSource:etaMinutes!==null?"OpenStreetMap road routing — excludes live traffic":null});
 });
 app.get("/api/customer/push/key",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  res.json({key:pushPublicKey(),...pushConfigurationStatus()});
 });
 app.post("/api/customer/push/subscribe",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  const sub=req.body||{},endpoint=String(sub.endpoint||"");
  if(!pushPublicKey())return res.status(503).json({message:pushConfigurationStatus().reason||"Push notifications not configured"});
  let parsed:URL;try{parsed=new URL(endpoint)}catch{return res.status(400).json({message:"Invalid subscription endpoint"})}
  if(parsed.protocol!=="https:"||endpoint.length>2048||!sub.keys?.p256dh||!sub.keys?.auth)return res.status(400).json({message:"Invalid push subscription"});
  const p256dh=String(sub.keys.p256dh),auth=String(sub.keys.auth);
  if(p256dh.length>256||auth.length>128)return res.status(400).json({message:"Invalid keys"});
  await pool.query(`INSERT INTO customer_push_subscriptions(endpoint,email,p256dh,auth) VALUES($1,$2,$3,$4)
  ON CONFLICT(endpoint) DO UPDATE SET email=EXCLUDED.email,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth`,[endpoint,email,p256dh,auth]);
  const raw=(req.cookies as any)?.sk_customer ?? (req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("sk_customer="))?.slice(12);
  const session=raw?await pool.query("SELECT test_recipient FROM customer_portal_sessions WHERE token_hash=$1 AND expires_at>now()",[hash(raw)]):null;
  const authorised=String(session?.rows[0]?.test_recipient||"").toLowerCase();
  const configured=normalize(await setting("customer_portal_test_email"));
  if(authorised&&configured&&authorised===configured&&(await setting("customer_portal_live","false"))!=="true"){
    await pool.query("INSERT INTO customer_push_test_devices(endpoint,customer_email,test_recipient) VALUES($1,$2,$3) ON CONFLICT(endpoint) DO UPDATE SET customer_email=EXCLUDED.customer_email,test_recipient=EXCLUDED.test_recipient,registered_at=now()",[endpoint,email,configured]);
  }else{
    await pool.query("DELETE FROM customer_push_test_devices WHERE endpoint=$1",[endpoint]);
  }
  res.json({ok:true});
 });
 app.post("/api/customer/push/unsubscribe",async(req,res)=>{
  const email=await sessionEmail(req);if(!email)return res.status(401).json({message:"Not signed in"});
  await pool.query("DELETE FROM customer_push_subscriptions WHERE email=$1 AND endpoint=$2",[email,String(req.body?.endpoint||"")]);
  await pool.query("DELETE FROM customer_push_test_devices WHERE customer_email=$1 AND endpoint=$2",[email,String(req.body?.endpoint||"")]);
  res.json({ok:true});
 });

 app.get("/api/customer/subscription-session/:token",async(req,res)=>{
  const email=await sessionEmail(req);
  if(!email)return res.status(401).json({authenticated:false});
  const invitation=await pool.query("SELECT 1 FROM subscription_invites WHERE token=$1 AND lower(trim(customer_email))=$2 LIMIT 1",[req.params.token,email]);
  if(!invitation.rowCount)return res.status(403).json({authenticated:true,matched:false});
  res.setHeader("Cache-Control","no-store");
  return res.json({authenticated:true,matched:true,email});
 });
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
  const testMode=(await setting("customer_portal_live","false"))!=="true";
  if(testMode && !req.session?.userId){
   try{
    if(!(await registerInterest(email,req)))return res.status(429).json({message:"We've had lots of interest! Please try again a little later."});
    return res.json({message:INTEREST_REPLY});
   }catch(error){
    console.error("Customer portal interest registration failed",error);
    return res.status(503).json({message:"Sorry, we couldn't save your interest just now. Please try again shortly."});
   }
  }
  const adminTesting=testMode && !!req.session?.userId;
  // Legitimate testing can require repeated login requests. Keep a higher
  // per-address allowance for authenticated administrators only.
  const hourlyLimit=adminTesting?60:5;
  const recent=await pool.query("SELECT count(*)::int AS n, min(created_at) AS oldest FROM customer_magic_links WHERE email=$1 AND created_at>now()-interval '1 hour'",[email]);
  const volume=await pool.query("SELECT count(*)::int AS n FROM customer_magic_links WHERE created_at>now()-interval '1 minute'");
  if(Number(recent.rows[0].n)>=hourlyLimit||Number(volume.rows[0].n)>100){
    const oldest=recent.rows[0].oldest?new Date(recent.rows[0].oldest).getTime():Date.now();
    const retrySeconds=Number(recent.rows[0].n)>=hourlyLimit?Math.max(1,Math.ceil((oldest+3600000-Date.now())/1000)):60;
    res.setHeader("Retry-After",String(retrySeconds));
    return res.status(429).json({message:adminTesting?"Testing request limit reached. Try again in "+Math.ceil(retrySeconds/60)+" minute(s).":"Too many sign-in requests. Please try again later.",retryAfterSeconds:retrySeconds});
  }

  if(await eligible(email)){
   const raw=token();
   const testRecipient=testMode?normalize(await setting("customer_portal_test_email")):null;
   await pool.query("INSERT INTO customer_magic_links(token_hash,email,expires_at,test_recipient) VALUES($1,$2,now()+interval '15 minutes',$3)",[hash(raw),email,testRecipient||null]);
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
   const r=await client.query("UPDATE customer_magic_links SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING email,test_recipient",[hash(raw)]);
   if(!r.rowCount){await client.query("ROLLBACK");return res.status(401).json({message:"This link has expired or was already used"})}
   const value=token();
   await client.query("INSERT INTO customer_portal_sessions(token_hash,email,expires_at,test_recipient) VALUES($1,$2,now()+interval '7 days',$3)",[hash(value),r.rows[0].email,r.rows[0].test_recipient]);
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
  WHERE lower(o.customer_email)=$1 AND (
    o.is_manual=false OR EXISTS (
      SELECT 1 FROM subscription_invites si
      WHERE si.selections_order_id=o.id OR si.tuesday_selections_order_id=o.id
    )
  )
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
