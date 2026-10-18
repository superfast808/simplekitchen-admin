import crypto from "node:crypto";

const base = "http://127.0.0.1:5000";
let cookie = "";
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function request(method, path, payload) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  const result = await fetch(base + path, {
    method, headers, body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: "manual",
  });
  const setCookie = result.headers.get("set-cookie");
  if (setCookie && setCookie.includes("connect.sid=")) {
    cookie = setCookie.split(";")[0];
  }
  const data = await result.json().catch(() => null);
  return { status: result.status, data };
}
function secretToBytes(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, n = 0;
  const bytes = [];
  for (const char of secret) {
    n = (n << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((n >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}
function totp(secret) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = crypto.createHmac("sha1", secretToBytes(secret)).update(counter).digest();
  const off = mac[19] & 15;
  return ((mac.readUInt32BE(off) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
async function main() {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await request("GET", "/healthz");
      if (response.status === 200) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
    if (i === 39) throw new Error("Server did not become healthy");
  }
  const login = await request("POST", "/api/auth/login", {
    username: "ci-admin", password: "CI-Admin-Password-Safeguard-2026!",
  });
  assert(login.status === 200 && login.data?.mfaRequired && login.data?.setupRequired,
    "Correct password must enter MFA enrolment, not create an authorised session");
  assert((await request("GET", "/api/auth/me")).status === 401,
    "Unverified staff session must fail /api/auth/me");
  assert((await request("GET", "/api/orders")).status === 401,
    "Unverified staff session must be blocked from Orders");
  const setup = await request("POST", "/api/auth/mfa/authenticator/start", {});
  assert(setup.status === 200 && setup.data?.secret && setup.data?.qr?.startsWith("data:image/png;"),
    "Authenticator setup must return a local QR and enrolment secret");
  assert((await request("GET", "/api/orders")).status === 401,
    "Starting MFA enrolment must not unlock Orders");
  const invalid = await request("POST", "/api/auth/mfa/authenticator/verify", { code: "bad" });
  assert(invalid.status >= 400, "Malformed TOTP must fail");
  const verified = await request("POST", "/api/auth/mfa/authenticator/verify", {
    code: totp(setup.data.secret),
  });
  assert(verified.status === 200 && verified.data?.verified,
    "Valid authenticator code must complete MFA");
  assert((await request("GET", "/api/auth/me")).status === 200,
    "Verified staff session should access /api/auth/me");
  assert((await request("GET", "/api/orders")).status === 200,
    "Verified staff session should access Orders");
  assert((await request("POST", "/api/auth/logout", {})).status === 200,
    "Logout should succeed");
  const again = await request("POST", "/api/auth/login", {
    username: "ci-admin", password: "CI-Admin-Password-Safeguard-2026!",
  });
  assert(again.status === 200 && !again.data?.setupRequired && again.data?.methods?.authenticator,
    "Returning staff must be prompted for enrolled authenticator");
  assert((await request("GET", "/api/orders")).status === 401,
    "Returning staff password must not grant admin access without MFA");
  console.log("PASS: password alone blocked; authenticator enrolment and verification work; returning login requires MFA.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
