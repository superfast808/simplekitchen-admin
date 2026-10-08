import crypto from "crypto";
import { pool } from "./db";
const settingNames = ["wc_admin_url", "wc_admin_key", "wc_admin_secret"] as const;
const secret=process.env.WC_CREDENTIAL_ENCRYPTION_KEY || process.env.SESSION_SECRET;
function key(){if(!secret || secret.length<32)throw new Error("SESSION_SECRET or WC_CREDENTIAL_ENCRYPTION_KEY must have at least 32 characters");return crypto.scryptSync(secret,"simple-kitchen-woo-secrets-v1",32)}
function encrypt(value:string){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key(),iv);const c=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return "enc:v1:"+Buffer.concat([iv,cipher.getAuthTag(),c]).toString("base64")}
function decrypt(value:string){if(!value.startsWith("enc:v1:"))throw Error("Unexpected credential format");const b=Buffer.from(value.slice(7),"base64");const d=crypto.createDecipheriv("aes-256-gcm",key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return Buffer.concat([d.update(b.subarray(28)),d.final()]).toString("utf8")}
async function readSaved(){const r=await pool.query("SELECT key,value FROM settings WHERE key=ANY($1::text[])",[settingNames]);return Object.fromEntries(r.rows.map(x=>[x.key,x.value])) as Record<string,string>}
export async function wooCredentials(){
 const saved=await readSaved();
 return {url:(saved.wc_admin_url||process.env.WC_STORE_URL||"").replace(/\/+$/,""),
 key:saved.wc_admin_key?decrypt(saved.wc_admin_key):(process.env.WC_CONSUMER_KEY||""),
 secret:saved.wc_admin_secret?decrypt(saved.wc_admin_secret):(process.env.WC_CONSUMER_SECRET||"")};
}
export async function saveWooCredentials(data:{url?:string;key?:string;secret?:string}){
 if(data.url!==undefined){const parsed=new URL(data.url);if(parsed.protocol!=="https:"||parsed.username||parsed.password||!parsed.hostname.includes("."))throw Error("A valid HTTPS WooCommerce store URL is required");}
 const entries:[string,string][]=[];
 if(data.url!==undefined)entries.push(["wc_admin_url",data.url.replace(/\/+$/,"")]);
 if(data.key)entries.push(["wc_admin_key",encrypt(data.key.trim())]);
 if(data.secret)entries.push(["wc_admin_secret",encrypt(data.secret.trim())]);
 for(const [name,value] of entries)await pool.query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",[name,value]);
}
export async function wooFetch(path:string,method:"GET"|"PUT"|"POST"="GET",body?:unknown){
 const c=await wooCredentials();if(!c.url||!c.key||!c.secret)throw Error("WooCommerce connection is not configured");
 const endpoint=c.url+"/wp-json/wc/v3/"+path;
 const began=Date.now();
 let res:Response;
 try {
  res=await fetch(endpoint,{method,headers:{Authorization:"Basic "+Buffer.from(c.key+":"+c.secret).toString("base64"),"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 }catch(e:any) {
  const elapsed=Math.round((Date.now()-began)/1000);
  throw Error("WooCommerce "+method+" /"+path+" failed after "+elapsed+"s: "+(e?.name==="TimeoutError"?"API did not respond within 20 seconds (check hosting/WAF, WordPress performance and WooCommerce API).":e?.message||"Network failure"));
 }
 const raw=await res.text();let json:any;try{json=JSON.parse(raw)}catch{json={message:raw.slice(0,300)}}
 if(!res.ok)throw Error("WooCommerce "+method+" /"+path+" returned HTTP "+res.status+" after "+((Date.now()-began)/1000).toFixed(1)+"s: "+(json?.message||"Request failed"));
 return json;
}
