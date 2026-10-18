import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Express, Request } from "express";
import type { Transporter } from "nodemailer";
import QRCode from "qrcode";
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { pool } from "./db";
import { storage } from "./storage";

type Hooks = {
  getTransporter: () => Promise<Transporter | null>;
  getFromEmail: () => Promise<string>;
  getSettings: () => Promise<Record<string, string>>;
};

declare module "express-session" {
  interface SessionData {
    mfaVerified?: boolean;
    mfaAt?: number;
    pendingUserId?: string;
    pendingAt?: number;
    mfaChallenge?: string;
    mfaChallengeAt?: number;
    mfaChallengeKind?: string;
    mfaTotpSetup?: string;
    mfaTotpSetupAt?: number;
    mfaEmailHash?: string;
    mfaEmailAddress?: string;
    mfaEmailPurpose?: "setup" | "verify";
    mfaEmailExpires?: number;
    mfaEmailSentAt?: number;
    mfaEmailAttempts?: number;
  }
}

const PENDING_LIMIT = 10 * 60 * 1000;
const RECENT_MFA_LIMIT = 10 * 60 * 1000;
const CLOCK_STEP_SECONDS = 30;
const codeDigits = /^\d{6}$/;
const b64 = (v: Buffer | Uint8Array) => Buffer.from(v).toString("base64url");
const secureEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const key = crypto.createHash("sha256")
  .update("simple-kitchen-staff-mfa-secrets-v1:" + String(process.env.SESSION_SECRET || "")).digest();
function encrypt(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return b64(Buffer.concat([iv, cipher.getAuthTag(), encrypted]));
}
function decrypt(value: string) {
  const bytes = Buffer.from(value, "base64url");
  const iv = bytes.subarray(0, 12), tag = bytes.subarray(12, 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32(buffer: Buffer) {
  let val = 0, bits = 0, output = "";
  for (const byte of buffer) {
    val = (val << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(val >>> bits) & 31]; }
  }
  if (bits > 0) output += alphabet[(val << (5 - bits)) & 31];
  return output;
}
function fromBase32(value: string) {
  let val = 0, bits = 0; const result: number[] = [];
  for (const char of value.replace(/[\s=]/g, "").toUpperCase()) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error("Invalid authenticator secret");
    val = (val << 5) | n; bits += 5;
    if (bits >= 8) { bits -= 8; result.push((val >>> bits) & 255); }
  }
  return Buffer.from(result);
}
function totp(secret: string, step: number) {
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", fromBase32(secret)).update(time).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
function matchingStep(secret: string, value: string) {
  if (!codeDigits.test(value)) return null;
  const now = Math.floor(Date.now() / 1000 / CLOCK_STEP_SECONDS);
  for (const step of [now, now - 1, now + 1]) {
    if (secureEqual(totp(secret, step), value)) return step;
  }
  return null;
}
async function methods(userId: string) {
  const result = await pool.query(
    "SELECT (SELECT COUNT(*)::int FROM staff_mfa_passkeys WHERE user_id=$1) AS passkeys, " +
    "EXISTS(SELECT 1 FROM staff_mfa_totp WHERE user_id=$1) AS authenticator, " +
    "(SELECT address FROM staff_mfa_email WHERE user_id=$1) AS email",
    [userId]
  );
  const row = result.rows[0];
  return { passkeys: Number(row.passkeys), authenticator: Boolean(row.authenticator),
    email: row.email ? String(row.email) : null };
}
async function actor(req: Request): Promise<{ id: string; first: boolean }> {
  const verified = req.session.userId && req.session.mfaVerified;
  const pending = req.session.pendingUserId && Number(req.session.pendingAt || 0) > Date.now() - PENDING_LIMIT;
  if (!verified && !pending) throw new Error("Sign in again to continue");
  const id = verified ? req.session.userId! : req.session.pendingUserId!;
  const method = await methods(id);
  return { id, first: method.passkeys === 0 && !method.authenticator && !method.email };
}
async function enrollmentAllowed(req: Request) {
  const a = await actor(req);
  if (!a.first && (!req.session.userId || !req.session.mfaVerified ||
    Number(req.session.mfaAt || 0) < Date.now() - RECENT_MFA_LIMIT)) {
    throw new Error("Verify an existing MFA method before adding a new method. Sign in again.");
  }
  return a.id;
}
function clearChallenges(req: Request) {
  req.session.pendingUserId = undefined;
  req.session.pendingAt = undefined;
  req.session.mfaChallenge = undefined;
  req.session.mfaChallengeAt = undefined;
  req.session.mfaChallengeKind = undefined;
  req.session.mfaTotpSetup = undefined;
  req.session.mfaTotpSetupAt = undefined;
  req.session.mfaEmailHash = undefined;
  req.session.mfaEmailPurpose = undefined;
  req.session.mfaEmailAddress = undefined;
  req.session.mfaEmailExpires = undefined;
  req.session.mfaEmailSentAt = undefined;
  req.session.mfaEmailAttempts = undefined;
}
async function complete(req: Request, res: any, id: string) {
  clearChallenges(req);
  req.session.userId = id;
  req.session.mfaVerified = true;
  req.session.mfaAt = Date.now();
  req.session.cookie.maxAge = 12 * 60 * 60 * 1000;
  req.session.save(async error => {
    if (error) return res.status(500).json({ message: "Could not save verified session" });
    const user = await storage.getUserById(id);
    return res.json({ verified: true, username: user?.username || "" });
  });
}
function fail(res: any, error: any) {
  const msg = String(error?.message || error);
  const known = /Sign in again|Verify an existing MFA|MFA|not enrolled|not supported|challenge|origin|credential|session/i.test(msg);
  return res.status(known ? 403 : 500).json({ message: known ? msg : "Verification failed. Please try again." });
}
async function relyingParty(req: Request, hooks: Hooks) {
  const settings = await hooks.getSettings();
  // Set portal_url to the HTTPS address staff actually use in Settings.
  const configured = process.env.MFA_ORIGIN || settings.portal_url || "";
  const origin = new URL(configured).origin;
  const hostname = new URL(origin).hostname;
  if (new URL(origin).protocol !== "https:" && hostname !== "localhost")
    throw new Error("Passkeys require an HTTPS admin portal URL");
  const rpID = process.env.MFA_RP_ID || hostname;
  const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0].trim().split(":")[0];
  if (requestHost !== rpID && !requestHost.endsWith("." + rpID)) {
    throw new Error("Passkey site does not match the configured admin domain");
  }
  return { rpID, origin };
}
function requireChallenge(req: Request, kind: string) {
  if (req.session.mfaChallengeKind !== kind || !req.session.mfaChallenge ||
    Date.now() - Number(req.session.mfaChallengeAt || 0) > 120000)
    throw new Error("Passkey challenge expired. Try again.");
  return req.session.mfaChallenge;
}
function rememberChallenge(req: Request, kind: string, challenge: string) {
  req.session.mfaChallengeKind = kind;
  req.session.mfaChallenge = challenge;
  req.session.mfaChallengeAt = Date.now();
}
export async function beginPasswordMfa(req: Request, res: any, userId: string) {
  req.session.regenerate(async error => {
    if (error) return res.status(500).json({ message: "Session error" });
    req.session.pendingUserId = userId;
    req.session.pendingAt = Date.now();
    try {
      const method = await methods(userId);
      req.session.save(err => err
        ? res.status(500).json({ message: "Session error" })
        : res.json({ mfaRequired: true, setupRequired: !method.passkeys && !method.authenticator && !method.email,
          methods: { passkey: method.passkeys > 0, authenticator: method.authenticator,
            email: !!method.email } }));
    } catch (err) { return fail(res, err); }
  });
}
export async function mfaSessionStatus(req: Request) {
  const verified = !!req.session.userId && !!req.session.mfaVerified;
  const pending = !!req.session.pendingUserId &&
    Date.now() - Number(req.session.pendingAt || 0) < PENDING_LIMIT;
  if (!verified && !pending) return { stage: "password" };
  const userId = verified ? req.session.userId! : req.session.pendingUserId!;
  const method = await methods(userId);
  return {
    stage: verified ? "authenticated" : (method.passkeys || method.authenticator || method.email) ? "verify" : "enrol",
    methods: { passkey: method.passkeys > 0, authenticator: method.authenticator, email: !!method.email },
    emailMasked: method.email ? method.email.replace(/^(.{1,2}).*(@.+)$/, "$1***$2") : null,
    passkeys: method.passkeys,
  };
}
export function registerStaffMfa(app: Express, hooks: Hooks) {
  app.get("/api/auth/mfa/status", async (req, res) => {
    try { return res.json(await mfaSessionStatus(req)); }
    catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/passkey/register/options", async (req, res) => {
    try {
      const id = await enrollmentAllowed(req);
      const user = await storage.getUserById(id);
      if (!user) return res.status(404).json({ message: "User not found" });
      const rp = await relyingParty(req, hooks);
      const existing = await pool.query("SELECT credential_id FROM staff_mfa_passkeys WHERE user_id=$1", [id]);
      const options = await generateRegistrationOptions({
        rpName: "Simple Kitchen Admin", rpID: rp.rpID,
        userID: new TextEncoder().encode(id), userName: user.username,
        attestationType: "none", authenticatorSelection: { residentKey: "preferred",
          userVerification: "required" }, preferredAuthenticatorType: "local",
        supportedAlgorithmIDs: [-7, -257],
        excludeCredentials: existing.rows.map((row: any) => ({ id: row.credential_id })),
      });
      rememberChallenge(req, "register", options.challenge);
      req.session.save(error => error
        ? res.status(500).json({ message: "Could not save passkey challenge" }) : res.json(options));
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/passkey/register/finish", async (req, res) => {
    try {
      const id = await enrollmentAllowed(req);
      const challenge = requireChallenge(req, "register");
      const rp = await relyingParty(req, hooks);
      const verification = await verifyRegistrationResponse({
        response: req.body, expectedChallenge: challenge,
        expectedOrigin: rp.origin, expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return res.status(401).json({ message: "Passkey registration was not verified" });
      }
      const credential = verification.registrationInfo.credential;
      req.session.mfaChallenge = undefined;
      await pool.query(
        "INSERT INTO staff_mfa_passkeys (credential_id,user_id,public_key,sign_count,transports) " +
        "VALUES ($1,$2,$3,$4,$5::jsonb)",
        [credential.id, id, Buffer.from(credential.publicKey), credential.counter,
          JSON.stringify(credential.transports || [])]
      );
      return complete(req, res, id);
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/passkey/options", async (req, res) => {
    try {
      const a = await actor(req);
      const rp = await relyingParty(req, hooks);
      const rows = await pool.query("SELECT credential_id,transports FROM staff_mfa_passkeys WHERE user_id=$1", [a.id]);
      if (!rows.rows.length) return res.status(400).json({ message: "No passkey is enrolled" });
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID, userVerification: "required",
        allowCredentials: rows.rows.map((r: any) => ({ id: r.credential_id,
          transports: r.transports || undefined })),
      });
      rememberChallenge(req, "authenticate", options.challenge);
      req.session.save(error => error
        ? res.status(500).json({ message: "Could not save challenge" }) : res.json(options));
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/passkey/finish", async (req, res) => {
    try {
      const a = await actor(req);
      const challenge = requireChallenge(req, "authenticate");
      const rp = await relyingParty(req, hooks);
      const rows = await pool.query(
        "SELECT credential_id, public_key, sign_count, transports FROM staff_mfa_passkeys " +
        "WHERE user_id=$1 AND credential_id=$2", [a.id, String(req.body?.id || "")]
      );
      if (!rows.rows.length) return res.status(401).json({ message: "Passkey not recognised" });
      const credential = rows.rows[0];
      const verification = await verifyAuthenticationResponse({
        response: req.body, expectedChallenge: challenge,
        expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
        credential: { id: credential.credential_id, publicKey: new Uint8Array(credential.public_key),
          counter: Number(credential.sign_count), transports: credential.transports || undefined },
      });
      if (!verification.verified) return res.status(401).json({ message: "Passkey verification failed" });
      const update = await pool.query(
        "UPDATE staff_mfa_passkeys SET sign_count=$3,last_used_at=NOW() " +
        "WHERE credential_id=$1 AND user_id=$2 AND sign_count=$4 RETURNING credential_id",
        [credential.credential_id, a.id, verification.authenticationInfo.newCounter, credential.sign_count]
      );
      if (!update.rows.length) return res.status(409).json({ message: "Passkey was already used. Try again." });
      return complete(req, res, a.id);
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/authenticator/start", async (req, res) => {
    try {
      const id = await enrollmentAllowed(req);
      const user = await storage.getUserById(id);
      if (!user) return res.status(404).json({ message: "User missing" });
      const secret = base32(crypto.randomBytes(20));
      req.session.mfaTotpSetup = encrypt(secret);
      req.session.mfaTotpSetupAt = Date.now();
      const uri = "otpauth://totp/" + encodeURIComponent("Simple Kitchen Admin:" + user.username) +
        "?secret=" + secret + "&issuer=" + encodeURIComponent("Simple Kitchen Admin") +
        "&algorithm=SHA1&digits=6&period=30";
      const qr = await QRCode.toDataURL(uri, { width: 236, margin: 2,
        errorCorrectionLevel: "M" });
      req.session.save(error => error
        ? res.status(500).json({ message: "Could not save authenticator enrolment" })
        : res.json({ secret, uri, qr }));
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/authenticator/verify", async (req, res) => {
    try {
      const a = await actor(req);
      const value = String(req.body?.code || "").replace(/\s/g, "");
      if (!codeDigits.test(value)) return res.status(400).json({ message: "Enter a six-digit code" });
      if (req.session.mfaTotpSetup) {
        await enrollmentAllowed(req);
        if (Date.now() - Number(req.session.mfaTotpSetupAt || 0) > PENDING_LIMIT)
          return res.status(410).json({ message: "Authenticator enrolment expired" });
        const secret = decrypt(req.session.mfaTotpSetup);
        const step = matchingStep(secret, value);
        if (step === null) return res.status(401).json({ message: "Incorrect authenticator code" });
        await pool.query(
          "INSERT INTO staff_mfa_totp (user_id,secret_enc,last_used_step) VALUES ($1,$2,$3) " +
          "ON CONFLICT (user_id) DO NOTHING", [a.id, encrypt(secret), step]
        );
        return complete(req, res, a.id);
      }
      const row = (await pool.query(
        "SELECT secret_enc FROM staff_mfa_totp WHERE user_id=$1", [a.id]
      )).rows[0];
      if (!row) return res.status(400).json({ message: "Authenticator not enrolled" });
      const step = matchingStep(decrypt(row.secret_enc), value);
      if (step === null) return res.status(401).json({ message: "Incorrect authenticator code" });
      const update = await pool.query(
        "UPDATE staff_mfa_totp SET last_used_step=$2 WHERE user_id=$1 AND last_used_step < $2 RETURNING user_id",
        [a.id, step]
      );
      if (!update.rowCount) return res.status(401).json({ message: "Code already used. Wait for the next code." });
      return complete(req, res, a.id);
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/email/send", async (req, res) => {
    try {
      const a = await actor(req);
      const saved = (await methods(a.id)).email;
      const isSetup = !saved || !!req.body?.setup;
      let address = saved;
      if (isSetup) {
        await enrollmentAllowed(req);
        address = String(req.body?.email || "").trim().toLowerCase();
      }
      if (!address || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address))
        return res.status(400).json({ message: "Enter a valid staff email address" });
      if (Date.now() - Number(req.session.mfaEmailSentAt || 0) < 60000)
        return res.status(429).json({ message: "Wait one minute before requesting another email code." });
      const transporter = await hooks.getTransporter();
      const from = await hooks.getFromEmail();
      if (!transporter || !from) return res.status(503).json({ message: "Email verification is unavailable. Ask an administrator to configure SMTP." });
      const code = String(crypto.randomInt(100000, 1000000));
      const secret = crypto.createHmac("sha256", key).update(a.id + ":" + code).digest("hex");
      req.session.mfaEmailHash = secret;
      req.session.mfaEmailAddress = address;
      req.session.mfaEmailPurpose = isSetup ? "setup" : "verify";
      req.session.mfaEmailExpires = Date.now() + 10 * 60000;
      req.session.mfaEmailSentAt = Date.now();
      req.session.mfaEmailAttempts = 0;
      await new Promise<void>((resolve, reject) => req.session.save(e => e ? reject(e) : resolve()));
      const mail = await transporter.sendMail({
        from, to: address, subject: "Simple Kitchen Admin — verification code",
        text: "Your Simple Kitchen Admin security code is " + code + ". It expires in 10 minutes. " +
          "Do not share this code. If you did not request it, contact the site administrator.",
        html: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;padding:24px">' +
          '<h2>Simple Kitchen Admin</h2><p>Use this one-time verification code:</p>' +
          '<p style="font-size:32px;letter-spacing:5px;font-weight:bold">' + code +
          '</p><p>Expires in 10 minutes. Never share this code.</p></div>',
      });
      if (!mail.accepted?.map((x: string) => x.toLowerCase()).includes(address))
        return res.status(502).json({ message: "Email server did not accept the address" });
      return res.json({ sent: true, to: address.replace(/^(.{1,2}).*(@.+)$/, "$1***$2") });
    } catch (e) { return fail(res, e); }
  });

  app.post("/api/auth/mfa/email/verify", async (req, res) => {
    try {
      const a = await actor(req);
      const code = String(req.body?.code || "").trim();
      if (!codeDigits.test(code)) return res.status(400).json({ message: "Enter a six-digit code" });
      if (!req.session.mfaEmailHash || Date.now() > Number(req.session.mfaEmailExpires || 0))
        return res.status(410).json({ message: "Email code expired. Request another." });
      req.session.mfaEmailAttempts = Number(req.session.mfaEmailAttempts || 0) + 1;
      const expected = crypto.createHmac("sha256", key).update(a.id + ":" + code).digest("hex");
      if (req.session.mfaEmailAttempts > 5 || !secureEqual(expected, req.session.mfaEmailHash)) {
        if (req.session.mfaEmailAttempts > 5) req.session.mfaEmailHash = undefined;
        await new Promise<void>(resolve => req.session.save(() => resolve()));
        return res.status(401).json({ message: "Incorrect code. Please try again." });
      }
      if (req.session.mfaEmailPurpose === "setup") {
        await enrollmentAllowed(req);
        await pool.query(
          "INSERT INTO staff_mfa_email (user_id,address) VALUES ($1,$2) " +
          "ON CONFLICT (user_id) DO UPDATE SET address=EXCLUDED.address,verified_at=NOW()",
          [a.id, req.session.mfaEmailAddress]
        );
      }
      return complete(req, res, a.id);
    } catch (e) { return fail(res, e); }
  });

  // Staff users currently share the existing admin-level user-management
  // permissions. Only an MFA-verified staff member who confirms their own
  // password can reset a colleague's methods, never their own.
  app.post("/api/users/:id/mfa-reset", async (req, res) => {
    if (!req.session.userId || !req.session.mfaVerified ||
      Number(req.session.mfaAt || 0) < Date.now() - RECENT_MFA_LIMIT)
      return res.status(403).json({ message: "Sign in with MFA again before resetting a staff member." });
    if (req.params.id === req.session.userId)
      return res.status(403).json({ message: "You cannot reset your own MFA. Ask another administrator." });
    if (req.body?.confirm !== "RESET_MFA")
      return res.status(400).json({ message: "Confirm the MFA reset" });
    const actorUser = await storage.getUserById(req.session.userId);
    if (!actorUser || !await bcrypt.compare(String(req.body?.password || ""), actorUser.password))
      return res.status(401).json({ message: "Your admin password is incorrect" });
    const target = await storage.getUserById(req.params.id);
    if (!target) return res.status(404).json({ message: "User not found" });
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query("DELETE FROM staff_mfa_passkeys WHERE user_id=$1", [target.id]);
      await connection.query("DELETE FROM staff_mfa_totp WHERE user_id=$1", [target.id]);
      await connection.query("DELETE FROM staff_mfa_email WHERE user_id=$1", [target.id]);
      await connection.query(
        "DELETE FROM session WHERE sess::jsonb ->> 'userId'=$1 OR sess::jsonb ->> 'pendingUserId'=$1",
        [target.id]
      );
      await connection.query("COMMIT");
      console.warn("Staff MFA reset: actor=" + req.session.userId + ", target=" + target.id);
      res.json({ reset: true, username: target.username });
    } catch (error: any) {
      await connection.query("ROLLBACK").catch(() => {});
      return fail(res, error);
    } finally { connection.release(); }
  });
}
