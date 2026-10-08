import crypto from "crypto";
import { pool } from "./db";

// Native RFC 8291 aes128gcm Web Push: no external package or lockfile changes.
const b64=(b:Buffer)=>b.toString("base64url");
const decode=(v:string)=>Buffer.from(v,"base64url");
function hkdf(salt:Buffer,ikm:Buffer,info:Buffer,n:number){return Buffer.from(crypto.hkdfSync("sha256",ikm,salt,info,n))}
function vapidKey(){
 const privateKey=process.env.CUSTOMER_PUSH_VAPID_PRIVATE_KEY||"";
 if(!privateKey)throw Error("CUSTOMER_PUSH_VAPID_PRIVATE_KEY is not configured");
 const ecdh=crypto.createECDH("prime256v1");ecdh.setPrivateKey(decode(privateKey));
 return {privateKey:ecdh.getPrivateKey(),publicKey:ecdh.getPublicKey(undefined,"uncompressed")};
}
export function pushPublicKey(){try{return b64(vapidKey().publicKey)}catch{return null}}
export function pushConfigurationStatus(){
  if(!process.env.CUSTOMER_PUSH_VAPID_PRIVATE_KEY)return {enabled:false,reason:"VAPID key missing from the server environment. Add CUSTOMER_PUSH_VAPID_PRIVATE_KEY to the app .env file and recreate the container."};
  try {vapidKey();return {enabled:true,reason:null}}catch{return {enabled:false,reason:"Invalid VAPID private key. Regenerate the key and restart the container."}}
}
async function deliver(endpoint:string,p256dh:string,auth:string,title:string,body:string){
 const keys=vapidKey(),receiver=decode(p256dh),secret=decode(auth);
 if(receiver.length!==65||secret.length!==16)throw Error("Invalid push subscription key");
 const sender=crypto.createECDH("prime256v1");sender.generateKeys();
 const senderPublic=sender.getPublicKey(undefined,"uncompressed");
 const shared=sender.computeSecret(receiver);
 const info=Buffer.concat([Buffer.from("WebPush: info\0"),receiver,senderPublic]);
 const ikm=hkdf(secret,shared,info,32);
 const salt=crypto.randomBytes(16);
 const cek=hkdf(salt,ikm,Buffer.from("Content-Encoding: aes128gcm\0"),16);
 const nonce=hkdf(salt,ikm,Buffer.from("Content-Encoding: nonce\0"),12);
 const payload=Buffer.concat([Buffer.from(JSON.stringify({title,body,tag:"simple-kitchen-"+crypto.randomBytes(6).toString("hex"),url:"/my"})),Buffer.from([2])]);
 const cipher=crypto.createCipheriv("aes-128-gcm",cek,nonce);
 const ciphertext=Buffer.concat([cipher.update(payload),cipher.final(),cipher.getAuthTag()]);
 const record=Buffer.alloc(5);record.writeUInt32BE(4096,0);record[4]=senderPublic.length;
 const encrypted=Buffer.concat([salt,record,senderPublic,ciphertext]);
 const origin=new URL(endpoint).origin,expiration=Math.floor(Date.now()/1000)+12*3600;
 const header=b64(Buffer.from(JSON.stringify({typ:"JWT",alg:"ES256"})));
 const claims=b64(Buffer.from(JSON.stringify({aud:origin,exp:expiration,sub:process.env.CUSTOMER_PUSH_VAPID_SUBJECT||"mailto:hello@simplekitchenprep.com"})));
 const signed=header+"."+claims;
 const jwk={kty:"EC" as const,crv:"P-256",d:b64(keys.privateKey),x:b64(keys.publicKey.subarray(1,33)),y:b64(keys.publicKey.subarray(33))};
 const signature=crypto.sign("sha256",Buffer.from(signed),{key:crypto.createPrivateKey({key:jwk,format:"jwk"}),dsaEncoding:"ieee-p1363"});
 const jwt=signed+"."+b64(signature);
 const response=await fetch(endpoint,{method:"POST",headers:{"TTL":"86400","Content-Encoding":"aes128gcm","Content-Type":"application/octet-stream","Authorization":"vapid t="+jwt+", k="+b64(keys.publicKey)},body:encrypted,signal:AbortSignal.timeout(12000)});
 if(response.status===404||response.status===410){await pool.query("DELETE FROM customer_push_subscriptions WHERE endpoint=$1",[endpoint]);throw Error("Push subscription expired (HTTP "+response.status+"). Re-enable notifications on the test device.")}
 if(!response.ok)throw Error("Push service responded "+response.status);
 await pool.query("UPDATE customer_push_subscriptions SET last_success_at=now() WHERE endpoint=$1",[endpoint]);
}
export async function sendPush(email:string,title:string,body:string){
 if(!pushPublicKey())return;
 const setting=await pool.query("SELECT value FROM settings WHERE key='customer_portal_live'");
 if(setting.rows[0]?.value!=="true")return; // never push to customers in test mode
 const r=await pool.query("SELECT endpoint,p256dh,auth FROM customer_push_subscriptions WHERE email=$1",[email.toLowerCase()]);
 await Promise.allSettled(r.rows.map(x=>deliver(x.endpoint,x.p256dh,x.auth,title,body)));
}

export async function sendDispatchTestPush(email:string,title:string,body:string){
 if(!pushPublicKey())throw Error("VAPID key not configured");
 const subs=await pool.query("SELECT endpoint,p256dh,auth FROM customer_push_subscriptions WHERE lower(email)=$1",[email.trim().toLowerCase()]);
 if(!subs.rowCount)throw Error("No push subscription registered for test email");
 const results=await Promise.allSettled(subs.rows.map(x=>deliver(x.endpoint,x.p256dh,x.auth,title,body)));
 const successful=results.filter(x=>x.status==="fulfilled").length;
 if(!successful){const errors=results.filter(x=>x.status==="rejected").map(x=>(x as PromiseRejectedResult).reason?.message||String((x as PromiseRejectedResult).reason));throw Error("Push delivery failed: "+errors.join("; ").slice(0,420))}
 return {registered:subs.rowCount,accepted:successful};
}
