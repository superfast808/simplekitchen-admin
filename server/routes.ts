import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fetchWooOrders, fetchWooProducts, fetchWooVariations, decodeHtmlEntities } from "./woocommerce";
import { insertProductSchema, insertIngredientSchema, insertOrderSchema, insertOrderItemSchema, insertManualQuantitySchema } from "@shared/schema";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import multer from "multer";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { log } from "./index";
import { getUncachableStripeClient } from "./stripeClient";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function parseSourceFilter(source: string | undefined): { website: boolean; tuesday: boolean; manual: boolean } | null {
  if (source === undefined || source === null) return null;
  if (source === "") return { website: false, tuesday: false, manual: false };
  const parts = source.split(",");
  return {
    website: parts.includes("website"),
    tuesday: parts.includes("tuesday"),
    manual: parts.includes("manual"),
  };
}

function matchesSource(item: { isManual: boolean; isTuesday: boolean }, filter: { website: boolean; tuesday: boolean; manual: boolean }): boolean {
  if (item.isTuesday) return filter.tuesday;
  if (item.isManual) return filter.manual;
  return filter.website;
}

let syncInterval: ReturnType<typeof setInterval> | null = null;
let syncInProgress = false;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

function buildAddressVariants(raw: string): string[] {
  const variants: string[] = [raw];
  let cleaned = raw.replace(/,\s*GB$/i, "").trim();
  if (cleaned !== raw) variants.push(cleaned);
  const noFlat = cleaned.replace(/^(Flat|Unit|Apt|Suite)\s+\S+,?\s*/i, "").trim();
  if (noFlat !== cleaned) variants.push(noFlat);
  const noSubunit = cleaned.replace(/^\d+\/\d+\s+/i, "").trim();
  if (noSubunit !== cleaned && !variants.includes(noSubunit)) variants.push(noSubunit);
  const postcodeMatch = raw.match(/([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})/i);
  if (postcodeMatch) {
    const cityMatch = raw.match(/,\s*([^,]+),\s*[A-Z]{1,2}\d/i);
    const city = cityMatch ? cityMatch[1].trim() : "";
    if (city) variants.push(`${postcodeMatch[1]}, ${city}`);
    variants.push(postcodeMatch[1]);
  }
  return variants;
}

// Returns the current week number (1-6) based on week1ReferenceDate setting.
// The week advances every Saturday at noon (every 7 days from the reference date).
async function getCurrentWeekInfo(asOf?: Date): Promise<{ weekNumber: number; categoryName: string }> {
  const refDateStr = await storage.getSetting("week1ReferenceDate");
  if (!refDateStr) return { weekNumber: 1, categoryName: "Week 1" };
  const refDate = new Date(refDateStr);
  const now = asOf ?? new Date();
  // The week boundary is at noon on each Saturday (matching the WooCommerce order-window open
  // time stored in week1ReferenceDate). Invite weekFrom and order-week 'from' dates are stored
  // as Saturday midnight (00:00 UTC), which is 12 h before the boundary and would otherwise
  // land in the previous week. Shift by +12 h so midnight Saturday aligns with the correct week.
  const normalized = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  const diffMs = normalized.getTime() - refDate.getTime();
  if (diffMs < 0) return { weekNumber: 1, categoryName: "Week 1" };
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
  const weekNumber = (diffWeeks % 6) + 1;
  return { weekNumber, categoryName: `Week ${weekNumber}` };
}

function applyAddDeliveryUpgrades(ordersWithItems: Array<{ customerEmail: string | null; customerName: string; fulfillmentType: string | null; items: Array<{ productName: string }> }>): void {
  const deliveryEmails = new Set<string>();
  const deliveryNames = new Set<string>();
  for (const o of ordersWithItems) {
    const hasAddDelivery = o.items.some(i => i.productName.toLowerCase().includes("add delivery"));
    if (hasAddDelivery) {
      if (o.customerEmail) deliveryEmails.add(o.customerEmail.toLowerCase());
      deliveryNames.add(o.customerName.toLowerCase());
    }
  }
  for (const o of ordersWithItems) {
    if (o.fulfillmentType === "delivery") continue;
    const emailMatch = o.customerEmail && deliveryEmails.has(o.customerEmail.toLowerCase());
    const nameMatch = deliveryNames.has(o.customerName.toLowerCase());
    if (emailMatch || nameMatch) {
      o.fulfillmentType = "delivery";
    }
  }
}

async function persistDeliveryUpgrades(): Promise<number> {
  const from = new Date();
  from.setDate(from.getDate() - 28);
  const ordersList = await storage.getOrders(from, new Date());
  const ordersWithItems = await Promise.all(
    ordersList.map(async (o) => ({ ...o, items: await storage.getOrderItems(o.id) }))
  );
  const originalTypes = new Map(ordersWithItems.map(o => [o.id, o.fulfillmentType]));
  applyAddDeliveryUpgrades(ordersWithItems);
  let upgraded = 0;
  for (const o of ordersWithItems) {
    if (o.fulfillmentType !== originalTypes.get(o.id)) {
      await storage.updateOrder(o.id, { fulfillmentType: o.fulfillmentType ?? "delivery" });
      log(`Delivery upgrade: order ${o.id} (${o.customerName}) → delivery`, "sync");
      upgraded++;
    }
  }
  return upgraded;
}

function detectFulfillmentType(wooOrder: any): string {
  const shippingLines = wooOrder.shipping_lines || [];
  if (shippingLines.length === 0) return "collection";
  for (const line of shippingLines) {
    const methodTitle = (line.method_title || "").toLowerCase();
    const methodId = (line.method_id || "").toLowerCase();
    if (methodTitle.startsWith("delivery") || methodId === "flat_rate") {
      return "delivery";
    }
  }
  return "collection";
}

const DEFAULT_EMAIL_SUBJECT = "Choose Your Meals This Week - Simple Kitchen Prep";
const DEFAULT_EMAIL_BODY = `<h2 style="color: #333;">Hi {{firstName}},</h2>
<p>It's time to choose your <strong>{{qty}} meals</strong> for this week!</p>
<p>Click the button below to select your preferences:</p>
<div style="text-align: center; margin: 30px 0;">
  <a href="{{url}}" style="background-color: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Choose My Meals</a>
</div>
<p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
<p style="color: #666; font-size: 12px; word-break: break-all;">{{url}}</p>
<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
<p style="color: #999; font-size: 12px;">Simple Kitchen Prep</p>`;

const DEFAULT_SETTINGS: Record<string, string> = {
  sync_interval_minutes: "60",
  sync_enabled: "true",
  order_window_open_day: "6",
  order_window_open_hour: "12",
  order_window_close_day: "3",
  order_window_close_hour: "24",
  week1ReferenceDate: "",
  subscription_email_subject: DEFAULT_EMAIL_SUBJECT,
  subscription_email_body: DEFAULT_EMAIL_BODY,
  portal_url: "https://admin.simplekitchenprep.com",
  smtp_host: "",
  smtp_port: "587",
  smtp_user: "",
  smtp_pass: "",
  smtp_from: "",
  stripe_mode: "test",
  stripe_test_secret_key: "",
  stripe_test_publishable_key: "",
  stripe_live_secret_key: "",
  stripe_live_publishable_key: "",
  packaging_cost: "0",
};

const ALLOWED_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const MIN_SYNC_INTERVAL = 5;
const MAX_SYNC_INTERVAL = 1440;

// Module-level SMTP transporter (available to auto-sync)
const smtpTransporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: parseInt(process.env.SMTP_PORT || "587") === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
}) : null;

// Base URL captured from first incoming HTTP request (used by auto-send emails)
let capturedBaseUrl = "";

// Module-level week range helper (used by both sync and send endpoint)
function getWeekRange(offset = 0): { from: Date; to: Date } {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const dayOfWeek = ukNow.getDay();
  let saturdayDate: Date;
  if (dayOfWeek === 6) {
    saturdayDate = new Date(ukNow);
  } else {
    const daysBack = dayOfWeek === 0 ? 1 : dayOfWeek + 1;
    saturdayDate = new Date(ukNow);
    saturdayDate.setDate(ukNow.getDate() - daysBack);
  }
  if (offset !== 0) {
    saturdayDate.setDate(saturdayDate.getDate() + offset * 7);
  }
  const from = new Date(saturdayDate);
  from.setHours(0, 0, 0, 0);
  const to = new Date(saturdayDate);
  to.setDate(to.getDate() + 4);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

// Auto-send window: Saturday through Wednesday 20:00 UK time
function isWithinAutoSendWindow(): boolean {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const day = ukNow.getDay(); // 0=Sun … 6=Sat
  if (day === 6 || day === 0 || day === 1 || day === 2) return true; // Sat–Tue always ok
  if (day === 3) return ukNow.getHours() < 20; // Wed before 8 pm ok
  return false; // Thu/Fri — closed, admin does it manually
}

// Extract subscription slots from an order.
// Returns one entry per subscription item found, with the correct isTuesday flag.
// For orders that contain both "Saturday Delivery" and "Tuesday Delivery" (dual-day orders),
// one slot gets isTuesday=false (Saturday) and one gets isTuesday=true (Tuesday).
// For "2 week" subscription products, one dual-day slot is returned (isDual=true).
const SUB_PATTERN = /meal\s+subscription\s*-\s*(\d+)/i;
const TWO_WEEK_PATTERN = /2\s*week/i;
const WEEKLY_SUB_PATTERN = /weekly.*meal.*subscription|meal.*subscription.*weekly/i;
function getSubscriptionSlots(order: { isTuesday: boolean; items: Array<{ productName: string; quantity?: number }> }): Array<{ qty: number; isTuesday: boolean; isDual: boolean }> {
  const subItems = order.items.filter(i => SUB_PATTERN.test(i.productName) || (WEEKLY_SUB_PATTERN.test(i.productName)));
  if (subItems.length === 0) return [];

  const hasSatDelivery = order.items.some(i => /saturday.*delivery|delivery.*saturday/i.test(i.productName));
  const hasTueDelivery = order.items.some(i => /tuesday.*delivery|delivery.*tuesday/i.test(i.productName));

  if (subItems.length > 1 && hasSatDelivery && hasTueDelivery) {
    // Dual-day order — assign alternate days (Sat first, then Tue, then repeat)
    return subItems.map((item, idx) => {
      const m = item.productName.match(SUB_PATTERN);
      const qty = m ? parseInt(m[1], 10) : (item.quantity || 0);
      return { qty, isTuesday: idx % 2 !== 0, isDual: false };
    }).filter(s => s.qty > 0);
  }

  // Single subscription (or same day repeated) — check for "2 week" dual-day flag
  return subItems.map(item => {
    // Try primary pattern first (e.g. "Meal Subscription - 6"),
    // then fall back to any trailing "- N" in the name (e.g. "Meal Subscription 2 week - 6")
    const m = item.productName.match(SUB_PATTERN) || item.productName.match(/-\s*(\d+)\s*$/);
    const qty = m ? parseInt(m[1], 10) : (item.quantity || 0);
    const isDual = TWO_WEEK_PATTERN.test(item.productName);
    return { qty, isTuesday: isDual ? false : order.isTuesday, isDual };
  }).filter(s => s.qty > 0);
}

// Attempt to auto-send subscription invite emails for any subscription order
// in the current week that hasn't already been invited.
async function autoSendSubscriptionInvites(): Promise<void> {
  // Never send real emails from the development environment — tokens only exist
  // in the local DB and customers would receive broken links to production.
  if (process.env.NODE_ENV !== "production") return;
  if (!isWithinAutoSendWindow()) return;

  try {
    const transporter = await getSmtpTransporter();
    if (!transporter) return;

    const baseUrl = await getPortalBaseUrl();
    const fromEmail = await getSmtpFromEmail();

    const week = getWeekRange(0);
    const ordersList = await storage.getOrders(week.from, week.to);
    const ordersWithItems = await Promise.all(
      ordersList.map(async (order) => ({ ...order, items: await storage.getOrderItems(order.id) }))
    );

    const subOrders = ordersWithItems.filter(o => o.items.some(i => SUB_PATTERN.test(i.productName) || WEEKLY_SUB_PATTERN.test(i.productName)));
    if (subOrders.length === 0) return;

    const existingInvites = await storage.getSubscriptionInvites(week.from, week.to);
    const alreadyInvitedKeys = new Set(existingInvites.map(i => (i as any).isDual ? `${i.orderId}-dual` : `${i.orderId}-${i.isTuesday}`));

    const settingsMap = await getSettingsMap();
    const emailSubject = settingsMap.subscription_email_subject || DEFAULT_EMAIL_SUBJECT;
    const emailBodyTemplate = settingsMap.subscription_email_body || DEFAULT_EMAIL_BODY;

    for (const order of subOrders) {
      const slots = getSubscriptionSlots(order);
      for (const slot of slots) {
        const key = slot.isDual ? `${order.id}-dual` : `${order.id}-${slot.isTuesday}`;
        if (alreadyInvitedKeys.has(key)) continue;

        const token = crypto.randomBytes(32).toString("hex");
        let inviteAddress = order.deliveryAddress || null;
        let inviteFulfillment = order.fulfillmentType || "delivery";
        if (!inviteAddress) {
          const pastAddr = await storage.getCustomerDeliveryAddress(order.customerEmail || "", order.customerName);
          if (pastAddr?.deliveryAddress) {
            inviteAddress = pastAddr.deliveryAddress;
            inviteFulfillment = pastAddr.fulfillmentType || "delivery";
          }
        }

        await storage.createSubscriptionInvite({
          orderId: order.id,
          customerEmail: order.customerEmail || "",
          customerName: order.customerName,
          token,
          subscriptionQuantity: slot.qty,
          status: "pending",
          weekFrom: week.from,
          weekTo: week.to,
          deliveryAddress: inviteAddress,
          fulfillmentType: inviteFulfillment,
          isTuesday: slot.isTuesday,
          isDual: slot.isDual,
        } as any);
        alreadyInvitedKeys.add(key);

        const toEmail = order.customerEmail;
        if (!toEmail) continue;

        const selectUrl = `${baseUrl}/subscribe/${token}`;
        const firstName = order.customerName.split(" ")[0];
        const dayLabel = slot.isDual ? " (Sat + Tue)" : (slot.isTuesday ? " (Tuesday)" : " (Saturday)");
        const emailBody = emailBodyTemplate
          .replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{fullName\}\}/g, order.customerName)
          .replace(/\{\{qty\}\}/g, String(slot.qty))
          .replace(/\{\{url\}\}/g, selectUrl);
        const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${emailBody}</div>`;

        try {
          await transporter.sendMail({
            from: fromEmail,
            to: toEmail,
            subject: (emailSubject
              .replace(/\{\{firstName\}\}/g, firstName)
              .replace(/\{\{fullName\}\}/g, order.customerName)
              .replace(/\{\{qty\}\}/g, String(slot.qty))) + (slots.length > 1 || slot.isDual ? dayLabel : ""),
            html: emailHtml,
          });
          log(`Auto-sent subscription invite to ${order.customerName} (${toEmail})${slot.isDual ? " (dual Sat+Tue)" : (slots.length > 1 ? dayLabel : "")}`, "sync");
        } catch (emailErr: any) {
          log(`Auto-send subscription email failed for ${order.customerName}: ${(emailErr as Error).message}`, "sync");
        }
      }
    }
  } catch (err: any) {
    log(`autoSendSubscriptionInvites error: ${err.message}`, "sync");
  }
}

async function getSettingsMap(): Promise<Record<string, string>> {
  const allSettings = await storage.getAllSettings();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const s of allSettings) {
    map[s.key] = s.value;
  }
  return map;
}

// Build a nodemailer transporter preferring DB-stored SMTP settings over env vars
async function getSmtpTransporter(): Promise<nodemailer.Transporter | null> {
  const s = await getSettingsMap();
  const host = s.smtp_host || process.env.SMTP_HOST;
  const port = parseInt(s.smtp_port || process.env.SMTP_PORT || "587");
  const user = s.smtp_user || process.env.SMTP_USER;
  const pass = s.smtp_pass || process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

// Return the portal base URL, preferring the DB-stored setting
async function getPortalBaseUrl(): Promise<string> {
  const s = await getSettingsMap();
  return s.portal_url?.trim() || capturedBaseUrl || "https://admin.simplekitchenprep.com";
}

// Return the from-address for subscription emails
async function getSmtpFromEmail(): Promise<string> {
  const s = await getSettingsMap();
  return s.smtp_from || process.env.SMTP_FROM_EMAIL || "";
}

// Return the active Stripe secret key (DB settings → env var → undefined for proxy fallback)
async function getActiveStripeSecretKey(): Promise<string | undefined> {
  const s = await getSettingsMap();
  const mode = s.stripe_mode || "test";
  const dbKey = mode === "live" ? s.stripe_live_secret_key : s.stripe_test_secret_key;
  if (dbKey && dbKey.trim()) return dbKey.trim();
  return process.env.STRIPE_SECRET_KEY;
}

// Return the active Stripe publishable key
async function getActiveStripePublishableKey(): Promise<string> {
  const s = await getSettingsMap();
  const mode = s.stripe_mode || "test";
  const dbKey = mode === "live" ? s.stripe_live_publishable_key : s.stripe_test_publishable_key;
  if (dbKey && dbKey.trim()) return dbKey.trim();
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}

async function performSync() {
  if (syncInProgress) {
    log("Auto-sync: skipping, previous sync still in progress", "sync");
    return;
  }
  syncInProgress = true;
  try {
    log("Auto-sync: starting order sync...", "sync");
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const params: Record<string, string> = {
      status: "processing,completed,on-hold,refunded,cancelled",
      after: fourWeeksAgo.toISOString(),
    };
    const wooOrders = await fetchWooOrders(params);
    let imported = 0;
    let updated = 0;

    for (const wo of wooOrders) {
      const existing = await storage.getOrderByWooId(wo.id);
      const shipping = wo.shipping || {};
      const billing = wo.billing || {};
      const customerName = `${shipping.first_name || billing.first_name || ""} ${shipping.last_name || billing.last_name || ""}`.trim() || "Unknown";
      const address = [
        shipping.address_1 || billing.address_1,
        shipping.address_2 || billing.address_2,
        shipping.city || billing.city,
        shipping.postcode || billing.postcode,
        shipping.country || billing.country,
      ].filter(Boolean).join(", ");

      const fulfillmentType = detectFulfillmentType(wo);

      const wooNote = wo.customer_note ? wo.customer_note.trim() : null;

      const orderData: Record<string, any> = {
        wooId: wo.id,
        customerName,
        customerEmail: billing.email || null,
        deliveryAddress: address || null,
        orderDate: new Date(wo.date_created),
        status: wo.status,
        fulfillmentType,
        isManual: false,
        shippingTotal: String(parseFloat(wo.shipping_total || "0").toFixed(2)),
      };

      if (existing) {
        if (!existing.deliveryLat || !existing.deliveryLng) {
          orderData.deliveryLat = null;
          orderData.deliveryLng = null;
        }
        // Sync WooCommerce customer note; preserve any manually-added note if WooCommerce has none
        if (wooNote) {
          orderData.notes = wooNote;
        } else if (!existing.notes) {
          orderData.notes = null;
        }
        await storage.updateOrder(existing.id, orderData);
        // Preserve any portal-added items before clearing WooCommerce items
        const portalItems = await storage.getPortalAddedItems(existing.id);
        await storage.deleteOrderItemsByOrderId(existing.id);
        for (const item of wo.line_items || []) {
          let product = await storage.getProductByWooId(item.product_id);
          if (!product && item.variation_id) product = await storage.getProductByWooId(item.variation_id);
          await storage.createOrderItem({
            orderId: existing.id,
            productId: product?.id || null,
            productName: decodeHtmlEntities(item.name),
            quantity: item.quantity,
            price: String(item.total || "0"),
          });
        }
        for (const pi of portalItems) {
          await storage.createOrderItem({
            orderId: existing.id,
            productId: pi.productId,
            productName: pi.productName,
            quantity: pi.quantity,
            price: pi.price ?? "0",
            portalAdded: true,
          });
        }
        updated++;
      } else {
        orderData.deliveryLat = null;
        orderData.deliveryLng = null;
        orderData.notes = wooNote;
        const order = await storage.createOrder(orderData);
        for (const item of wo.line_items || []) {
          const product = await storage.getProductByWooId(item.product_id);
          await storage.createOrderItem({
            orderId: order.id,
            productId: product?.id || null,
            productName: decodeHtmlEntities(item.name),
            quantity: item.quantity,
            price: String(item.total || "0"),
          });
        }
        imported++;
      }
    }

    log(`Auto-sync complete: imported=${imported}, updated=${updated}, total=${wooOrders.length}`, "sync");
    const upgraded = await persistDeliveryUpgrades();
    if (upgraded > 0) log(`Auto-sync: persisted delivery upgrade for ${upgraded} order(s)`, "sync");
    // After sync, auto-send any subscription invite emails that are still pending
    await autoSendSubscriptionInvites();
  } catch (error: any) {
    log(`Auto-sync failed: ${error.message}`, "sync");
  } finally {
    syncInProgress = false;
  }
}

async function startAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }

  const settingsMap = await getSettingsMap();
  const enabled = settingsMap.sync_enabled === "true";
  let intervalMinutes = parseInt(settingsMap.sync_interval_minutes) || 60;
  intervalMinutes = Math.max(MIN_SYNC_INTERVAL, Math.min(MAX_SYNC_INTERVAL, intervalMinutes));

  if (enabled) {
    log(`Auto-sync enabled: every ${intervalMinutes} minutes`, "sync");
    syncInterval = setInterval(performSync, intervalMinutes * 60 * 1000);
    startupTimeout = setTimeout(performSync, 5000);
  } else {
    log("Auto-sync disabled", "sync");
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Capture base URL from the first request so auto-send emails have correct links
  app.use((req, _res, next) => {
    if (!capturedBaseUrl) {
      const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
      capturedBaseUrl = `${proto}://${req.headers.host}`;
    }
    next();
  });

  const userCount = await storage.countUsers();
  if (userCount === 0) {
    const hashedPassword = await bcrypt.hash("admin", 10);
    await storage.createUser({ username: "admin", password: hashedPassword });
    log("Created default admin user (username: admin)", "auth");
  }

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ message: "Session error" });
        }
        req.session.userId = user.id;
        req.session.save(() => {
          res.json({ id: user.id, username: user.username });
        });
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/logo", async (_req, res) => {
    try {
      const logo = await storage.getSetting("logo");
      if (logo) {
        res.json({ logo });
      } else {
        res.status(404).json({ logo: null });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    res.json({ id: user.id, username: user.username });
  });

  app.get("/api/users", async (_req, res) => {
    try {
      const usersList = await storage.getUsers();
      res.json(usersList.map(u => ({ id: u.id, username: u.username })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/users", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (password.length < 4) {
        return res.status(400).json({ message: "Password must be at least 4 characters" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({ username, password: hashedPassword });
      res.json({ id: user.id, username: user.username });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/users/:id", async (req, res) => {
    try {
      const count = await storage.countUsers();
      if (count <= 1) {
        return res.status(400).json({ message: "Cannot delete the last user" });
      }
      await storage.deleteUser(req.params.id);
      res.json({ message: "User deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/products", async (_req, res) => {
    try {
      const products = await storage.getProducts();
      res.json(products);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/current-week", async (_req, res) => {
    try {
      const { weekNumber, categoryName } = await getCurrentWeekInfo();
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);
      const meals = weekProducts.filter(p => Math.abs(parseFloat(p.price || "0") - 7.75) < 0.01).sort((a, b) => a.name.localeCompare(b.name));
      const extras = weekProducts.filter(p => { const pr = parseFloat(p.price || "0"); return pr > 0 && Math.abs(pr - 7.75) >= 0.01; }).sort((a, b) => a.name.localeCompare(b.name));
      const week1ReferenceDate = await storage.getSetting("week1ReferenceDate");
      res.json({ weekNumber, categoryName, meals, extras, week1ReferenceDate: week1ReferenceDate || null });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/products/current-week", async (_req, res) => {
    try {
      const { categoryName } = await getCurrentWeekInfo();
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);
      res.json(weekProducts.length > 0 ? weekProducts : allProducts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const product = await storage.getProduct(parseInt(req.params.id));
      if (!product) return res.status(404).json({ message: "Product not found" });
      res.json(product);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/products/:id/ingredients", async (req, res) => {
    try {
      const ingredientsList = await storage.getIngredients(parseInt(req.params.id));
      res.json(ingredientsList);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/products/:id/ingredients", async (req, res) => {
    try {
      const productId = parseInt(req.params.id);
      const ingredientsList = req.body.ingredients as Array<{ name: string; quantityPerUnit: string; unit: string; costPerG?: string }>;
      await storage.deleteIngredientsByProductId(productId);
      const created = [];
      for (const ing of ingredientsList) {
        const result = await storage.createIngredient({
          productId,
          name: ing.name,
          quantityPerUnit: ing.quantityPerUnit,
          unit: ing.unit,
          costPerG: ing.costPerG || null,
        });
        created.push(result);
        // Auto-upsert into standard ingredients library if costPerG is present
        if (ing.costPerG && ing.name.trim()) {
          await storage.upsertStandardIngredient(ing.name.trim(), ing.costPerG, ing.unit || "g");
        }
      }
      res.json(created);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/orders", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const ordersList = await storage.getOrders(from, to);
      const ordersWithItems = await Promise.all(
        ordersList.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);

      // Build subscription-stamp annotation: map stamped order ID → parent WooCommerce order total
      const allInvites = await storage.getSubscriptionInvites();
      const stampedToParentId = new Map<number, number>();
      for (const invite of allInvites) {
        if ((invite as any).selectionsOrderId && invite.orderId) {
          stampedToParentId.set((invite as any).selectionsOrderId, invite.orderId);
        }
        if ((invite as any).tuesdaySelectionsOrderId && invite.orderId) {
          stampedToParentId.set((invite as any).tuesdaySelectionsOrderId, invite.orderId);
        }
      }
      const parentIdToTotal = new Map<number, number>();
      for (const parentId of new Set(stampedToParentId.values())) {
        const parentItems = await storage.getOrderItems(parentId);
        const parentOrder = ordersList.find(o => o.id === parentId);
        const itemsTotal = parentItems.reduce((s, i) => s + parseFloat(i.price || "0"), 0);
        const shipping = parseFloat((parentOrder as any)?.shippingTotal || "0");
        parentIdToTotal.set(parentId, itemsTotal + shipping);
      }

      const annotated = ordersWithItems.map(o => {
        const parentId = stampedToParentId.get(o.id);
        return {
          ...o,
          isSubscriptionStamped: stampedToParentId.has(o.id),
          parentOrderTotal: parentId != null ? (parentIdToTotal.get(parentId) ?? null) : null,
        };
      });

      res.json(annotated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/orders", async (req, res) => {
    try {
      const { items, saveAsConsistent, ...orderData } = req.body;
      if (!orderData.customerName || typeof orderData.customerName !== "string") {
        return res.status(400).json({ message: "Customer name is required" });
      }
      const order = await storage.createOrder({
        ...orderData,
        isManual: true,
        orderDate: orderData.orderDate ? new Date(orderData.orderDate) : new Date(),
      });
      if (items && Array.isArray(items)) {
        for (const item of items) {
          await storage.createOrderItem({
            orderId: order.id,
            productId: item.productId || null,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price || "0",
          });
        }
      }
      if (saveAsConsistent !== false) {
        const isTuesdayOrder = orderData.isTuesday === true;
        const allRecurring = await storage.getRecurringOrders();
        const existing = allRecurring.find(
          ro => ro.customerName.toLowerCase() === orderData.customerName.toLowerCase()
            && ro.isTuesday === isTuesdayOrder
        );
        if (!existing) {
          const ro = await storage.createRecurringOrder({
            customerName: orderData.customerName,
            deliveryAddress: orderData.deliveryAddress || null,
            fulfillmentType: orderData.fulfillmentType || "collection",
            active: true,
            isTuesday: isTuesdayOrder,
            notes: orderData.notes || null,
          });
          if (items && Array.isArray(items)) {
            for (const item of items) {
              if (item.productName?.trim()) {
                await storage.createRecurringOrderItem({
                  recurringOrderId: ro.id,
                  productName: item.productName,
                  quantity: item.quantity || 1,
                });
              }
            }
          }
        }
      }
      const orderItems = await storage.getOrderItems(order.id);
      res.json({ ...order, items: orderItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/orders/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getOrder(id);
      if (!existing) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (!existing.isManual) {
        return res.status(400).json({ message: "Only manual orders can be edited" });
      }

      const { items, ...updates } = req.body;

      const orderUpdate: any = {};
      if (updates.customerName !== undefined) orderUpdate.customerName = updates.customerName;
      if (updates.deliveryAddress !== undefined) orderUpdate.deliveryAddress = updates.deliveryAddress;
      if (updates.fulfillmentType !== undefined) orderUpdate.fulfillmentType = updates.fulfillmentType;
      if (updates.status !== undefined) orderUpdate.status = updates.status;
      if (updates.isTuesday !== undefined) orderUpdate.isTuesday = updates.isTuesday;
      if (updates.notes !== undefined) orderUpdate.notes = updates.notes;
      if (updates.cashAmount !== undefined) orderUpdate.cashAmount = updates.cashAmount;
      if (updates.paymentMethod !== undefined) orderUpdate.paymentMethod = updates.paymentMethod;
      if (updates.orderDate !== undefined) orderUpdate.orderDate = new Date(updates.orderDate);

      const updated = await storage.updateOrder(id, orderUpdate);

      if (items && Array.isArray(items)) {
        await storage.deleteOrderItemsByOrderId(id);
        for (const item of items) {
          await storage.createOrderItem({
            orderId: id,
            productId: item.productId || null,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price || "0",
          });
        }
      }

      const orderItems = await storage.getOrderItems(id);
      res.json({ ...updated, items: orderItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/orders/:id/packing", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getOrder(id);
      if (!existing) return res.status(404).json({ message: "Order not found" });
      const updates: any = {};
      if (req.body.readyToPack !== undefined) updates.readyToPack = req.body.readyToPack;
      if (req.body.paymentMethod !== undefined) updates.paymentMethod = req.body.paymentMethod;
      if (req.body.cashAmount !== undefined) updates.cashAmount = req.body.cashAmount;
      const updated = await storage.updateOrder(id, updates);
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/orders/:id", async (req, res) => {
    try {
      await storage.deleteOrder(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/order-items", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const items = await storage.getOrderItemsByDateRange(from, to);
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/product-totals", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const sourceFilter = parseSourceFilter(req.query.source as string | undefined);
      let items = await storage.getOrderItemsByDateRange(from, to);
      if (sourceFilter) {
        items = items.filter(item => matchesSource(item, sourceFilter));
      }
      const includeManualStock = !sourceFilter || sourceFilter.manual;
      const manualQtys = includeManualStock ? await storage.getManualQuantities(from, to) : [];

      type ProductTotalEntry = {
        productName: string;
        productId: number | null;
        totalOrdered: number;
        manualQuantity: number;
        customerBreakdown: Record<string, number>;
      };
      const totals: Record<string, ProductTotalEntry> = {};
      for (const item of items) {
        const key = item.productName;
        if (!totals[key]) {
          totals[key] = { productName: key, productId: item.productId, totalOrdered: 0, manualQuantity: 0, customerBreakdown: {} };
        }
        totals[key].totalOrdered += item.quantity;
        const cName = (item.customerName || "Unknown").trim();
        totals[key].customerBreakdown[cName] = (totals[key].customerBreakdown[cName] || 0) + item.quantity;
      }
      for (const mq of manualQtys) {
        const product = await storage.getProduct(mq.productId);
        if (product) {
          const key = product.name;
          if (!totals[key]) {
            totals[key] = { productName: key, productId: product.id, totalOrdered: 0, manualQuantity: 0, customerBreakdown: {} };
          }
          totals[key].manualQuantity += mq.quantity;
        }
      }

      res.json(Object.values(totals).map(({ customerBreakdown, ...rest }) => ({
        ...rest,
        customerBreakdown: Object.entries(customerBreakdown)
          .map(([customerName, quantity]) => ({ customerName, quantity }))
          .sort((a, b) => b.quantity - a.quantity),
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ingredient-summary", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const sourceFilter = parseSourceFilter(req.query.source as string | undefined);
      let items = await storage.getOrderItemsByDateRange(from, to);
      if (sourceFilter) {
        items = items.filter(item => matchesSource(item, sourceFilter));
      }
      const includeManualStock = !sourceFilter || sourceFilter.manual;
      const manualQtys = includeManualStock ? await storage.getManualQuantities(from, to) : [];
      const allIngredients = await storage.getAllIngredients();
      const allProducts = await storage.getProducts();

      // Group quantities by product name so duplicate product IDs for the same name are merged
      const quantsByName: Record<string, number> = {};
      for (const item of items) {
        const name = (item.productName || "").toLowerCase().trim();
        if (name) quantsByName[name] = (quantsByName[name] || 0) + item.quantity;
      }
      for (const mq of manualQtys) {
        const product = allProducts.find(p => p.id === mq.productId);
        if (product) {
          const name = product.name.toLowerCase().trim();
          quantsByName[name] = (quantsByName[name] || 0) + mq.quantity;
        }
      }
      // Build name lookup per product ID for ingredient resolution
      const nameByProductId: Record<number, string> = {};
      for (const p of allProducts) nameByProductId[p.id] = p.name.toLowerCase().trim();

      const summary: Record<string, { name: string; totalQuantity: number; unit: string }> = {};
      // Track ingredient+productName combos to avoid double-counting from duplicate products
      const seenIngredient = new Set<string>();
      for (const ingredient of allIngredients) {
        const productName = nameByProductId[ingredient.productId];
        if (!productName) continue;
        const ingNameNorm = ingredient.name.toLowerCase().trim();
        const ingUnitNorm = ingredient.unit.toLowerCase().trim();
        const dedupeKey = `${productName}|${ingNameNorm}|${ingUnitNorm}`;
        if (seenIngredient.has(dedupeKey)) continue;
        seenIngredient.add(dedupeKey);
        const productQty = quantsByName[productName] || 0;
        if (productQty > 0) {
          const key = `${ingNameNorm}_${ingUnitNorm}`;
          const needed = productQty * parseFloat(ingredient.quantityPerUnit);
          if (!summary[key]) {
            summary[key] = { name: ingredient.name, totalQuantity: 0, unit: ingredient.unit };
          }
          summary[key].totalQuantity += needed;
        }
      }

      res.json(Object.values(summary).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ingredient-breakdown", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const sourceFilter = parseSourceFilter(req.query.source as string | undefined);
      let items = await storage.getOrderItemsByDateRange(from, to);
      if (sourceFilter) {
        items = items.filter(item => matchesSource(item, sourceFilter));
      }
      const includeManualStock = !sourceFilter || sourceFilter.manual;
      const manualQtys = includeManualStock ? await storage.getManualQuantities(from, to) : [];
      const allIngredients = await storage.getAllIngredients();
      const allProducts = await storage.getProducts();

      // Group quantities by product name so duplicate product IDs for the same name are merged
      const quantsByName2: Record<string, number> = {};
      for (const item of items) {
        const name = (item.productName || "").toLowerCase().trim();
        if (name) quantsByName2[name] = (quantsByName2[name] || 0) + item.quantity;
      }
      for (const mq of manualQtys) {
        const product = allProducts.find(p => p.id === mq.productId);
        if (product) {
          const name = product.name.toLowerCase().trim();
          quantsByName2[name] = (quantsByName2[name] || 0) + mq.quantity;
        }
      }

      // Deduplicate products by name — keep the first occurrence per name
      const seenProductNames = new Set<string>();
      const uniqueProducts = allProducts.filter(p => {
        const key = p.name.toLowerCase().trim();
        if (seenProductNames.has(key)) return false;
        seenProductNames.add(key);
        return true;
      });

      // Build ingredients per unique product (deduplicated by name+unit within each product name)
      const ingredientsByProductName: Record<string, typeof allIngredients> = {};
      const seenIngredientKeys = new Set<string>();
      for (const ing of allIngredients) {
        const product = allProducts.find(p => p.id === ing.productId);
        if (!product) continue;
        const productName = product.name.toLowerCase().trim();
        const dedupe = `${productName}|${ing.name.toLowerCase().trim()}|${ing.unit.toLowerCase().trim()}`;
        if (seenIngredientKeys.has(dedupe)) continue;
        seenIngredientKeys.add(dedupe);
        if (!ingredientsByProductName[productName]) ingredientsByProductName[productName] = [];
        ingredientsByProductName[productName].push(ing);
      }

      const productBreakdowns: Array<{
        productId: number;
        productName: string;
        orderedQuantity: number;
        ingredients: Array<{
          name: string;
          quantityPerUnit: string;
          unit: string;
          totalNeeded: number;
          costPerG: string | null;
          costPerMeal: number | null;
          totalCost: number | null;
        }>;
      }> = [];

      const grandTotals: Record<string, { name: string; totalQuantity: number; unit: string; totalCost: number | null }> = {};

      for (const product of uniqueProducts) {
        const productNameKey = product.name.toLowerCase().trim();
        const pIngredients = ingredientsByProductName[productNameKey];
        if (!pIngredients || pIngredients.length === 0) continue;
        const orderedQty = quantsByName2[productNameKey] || 0;

        productBreakdowns.push({
          productId: product.id,
          productName: product.name,
          orderedQuantity: orderedQty,
          ingredients: pIngredients.map(ing => {
            const totalNeeded = orderedQty * parseFloat(ing.quantityPerUnit);
            const key = `${ing.name.toLowerCase().trim()}_${ing.unit.toLowerCase().trim()}`;
            const costPerG = (ing as any).costPerG != null ? String((ing as any).costPerG) : null;
            const costPerMeal = costPerG != null ? parseFloat(costPerG) * parseFloat(ing.quantityPerUnit) : null;
            const totalCost = costPerG != null ? totalNeeded * parseFloat(costPerG) : null;
            if (!grandTotals[key]) {
              grandTotals[key] = { name: ing.name, totalQuantity: 0, unit: ing.unit, totalCost: null };
            }
            grandTotals[key].totalQuantity += totalNeeded;
            if (totalCost != null) {
              grandTotals[key].totalCost = (grandTotals[key].totalCost ?? 0) + totalCost;
            }
            return {
              name: ing.name,
              quantityPerUnit: ing.quantityPerUnit,
              unit: ing.unit,
              totalNeeded,
              costPerG,
              costPerMeal,
              totalCost,
            };
          }),
        });
      }

      productBreakdowns.sort((a, b) => {
        if (a.orderedQuantity > 0 && b.orderedQuantity === 0) return -1;
        if (a.orderedQuantity === 0 && b.orderedQuantity > 0) return 1;
        return a.productName.localeCompare(b.productName);
      });

      res.json({
        products: productBreakdowns,
        grandTotals: Object.values(grandTotals).sort((a, b) => a.name.localeCompare(b.name)),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ingredient-names", async (_req, res) => {
    try {
      const [allIngredients, standards] = await Promise.all([
        storage.getAllIngredients(),
        storage.getStandardIngredients(),
      ]);
      // Deduplicate case-insensitively, preserving first-seen display name
      const nameMap = new Map<string, string>();
      const unitMap = new Map<string, string>();
      for (const i of allIngredients) {
        const nk = i.name.toLowerCase().trim();
        if (!nameMap.has(nk)) nameMap.set(nk, i.name.trim());
        const uk = i.unit.toLowerCase().trim();
        if (!unitMap.has(uk)) unitMap.set(uk, i.unit.trim());
      }
      const uniqueNames = Array.from(nameMap.values()).sort();
      const uniqueUnits = Array.from(unitMap.values()).sort();
      res.json({ names: uniqueNames, units: uniqueUnits, standards });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/standard-ingredients", async (_req, res) => {
    try {
      res.json(await storage.getStandardIngredients());
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/standard-ingredients", async (req, res) => {
    try {
      const { name, costPerG, unit } = req.body;
      if (!name || !costPerG || !unit) return res.status(400).json({ message: "name, costPerG and unit are required" });
      const result = await storage.upsertStandardIngredient(name.trim(), costPerG, unit);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/standard-ingredients/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { costPerG, unit } = req.body;
      const updated = await storage.updateStandardIngredient(id, { costPerG, unit });
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/standard-ingredients/:id", async (req, res) => {
    try {
      await storage.deleteStandardIngredient(parseInt(req.params.id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/manual-quantities", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const quantities = await storage.getManualQuantities(from, to);
      res.json(quantities);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/manual-quantities", async (req, res) => {
    try {
      const { productId, quantity } = req.body;
      if (!productId || !quantity || typeof quantity !== "number" || quantity < 1) {
        return res.status(400).json({ message: "Valid productId and quantity (>= 1) are required" });
      }
      const mq = await storage.createManualQuantity({
        productId,
        quantity,
        date: req.body.date ? new Date(req.body.date) : new Date(),
        note: req.body.note || null,
      });
      res.json(mq);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/manual-quantities/:id", async (req, res) => {
    try {
      await storage.deleteManualQuantity(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/woo/sync-orders", async (req, res) => {
    try {
      const params: Record<string, string> = { status: "processing,completed,on-hold" };
      if (req.query.after) {
        params.after = req.query.after as string;
      } else {
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
        params.after = fourWeeksAgo.toISOString();
      }
      const wooOrders = await fetchWooOrders(params);
      let imported = 0;
      let updated = 0;

      for (const wo of wooOrders) {
        const existing = await storage.getOrderByWooId(wo.id);
        const shipping = wo.shipping || {};
        const billing = wo.billing || {};
        const customerName = `${shipping.first_name || billing.first_name || ""} ${shipping.last_name || billing.last_name || ""}`.trim() || "Unknown";
        const address = [
          shipping.address_1 || billing.address_1,
          shipping.address_2 || billing.address_2,
          shipping.city || billing.city,
          shipping.postcode || billing.postcode,
          shipping.country || billing.country,
        ].filter(Boolean).join(", ");

        const fulfillmentType = detectFulfillmentType(wo);

        const orderData: Record<string, any> = {
          wooId: wo.id,
          customerName,
          customerEmail: billing.email || null,
          deliveryAddress: address || null,
          orderDate: new Date(wo.date_created),
          status: wo.status,
          fulfillmentType,
          isManual: false,
          shippingTotal: String(parseFloat(wo.shipping_total || "0").toFixed(2)),
        };

        if (existing) {
          if (!existing.deliveryLat || !existing.deliveryLng) {
            orderData.deliveryLat = null;
            orderData.deliveryLng = null;
          }
          await storage.updateOrder(existing.id, orderData);
          // Preserve any portal-added items before clearing WooCommerce items
          const portalItems = await storage.getPortalAddedItems(existing.id);
          await storage.deleteOrderItemsByOrderId(existing.id);
          for (const item of wo.line_items || []) {
            const product = await storage.getProductByWooId(item.product_id);
            await storage.createOrderItem({
              orderId: existing.id,
              productId: product?.id || null,
              productName: decodeHtmlEntities(item.name),
              quantity: item.quantity,
              price: String(item.total || "0"),
            });
          }
          for (const pi of portalItems) {
            await storage.createOrderItem({
              orderId: existing.id,
              productId: pi.productId,
              productName: pi.productName,
              quantity: pi.quantity,
              price: pi.price ?? "0",
              portalAdded: true,
            });
          }
          updated++;
        } else {
          orderData.deliveryLat = null;
          orderData.deliveryLng = null;
          const order = await storage.createOrder(orderData);
          for (const item of wo.line_items || []) {
            let product = await storage.getProductByWooId(item.product_id);
            if (!product && item.variation_id) product = await storage.getProductByWooId(item.variation_id);
            await storage.createOrderItem({
              orderId: order.id,
              productId: product?.id || null,
              productName: decodeHtmlEntities(item.name),
              quantity: item.quantity,
              price: String(item.total || "0"),
            });
          }
          imported++;
        }
      }

      const upgraded = await persistDeliveryUpgrades();
      res.json({ imported, updated, upgraded, total: wooOrders.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/woo/sync-products", async (_req, res) => {
    try {
      const wooProducts = await fetchWooProducts({ status: "any" });
      let imported = 0;
      let updated = 0;

      // Collect all products including variations for variable products
      const allWooProducts: any[] = [];
      for (const wp of wooProducts) {
        allWooProducts.push(wp);
        if (wp.type && (wp.type.includes("variable"))) {
          const variations = await fetchWooVariations(wp.id, wp);
          allWooProducts.push(...variations);
        }
      }

      for (const wp of allWooProducts) {
        const existing = await storage.getProductByWooId(wp.id);
        // For variations, build name from parent name + attribute values
        let name = decodeHtmlEntities(wp.name || wp._parentName || "");
        if (wp._parentName && wp.attributes?.length) {
          const attrs = wp.attributes.map((a: any) => a.option).filter(Boolean).join(", ");
          if (attrs) name = `${decodeHtmlEntities(wp._parentName)} - ${attrs}`;
        }
        const productData = {
          wooId: wp.id,
          name,
          price: String(wp.price || "0"),
          imageUrl: (wp.images?.[0]?.src || wp._parentImages?.[0]?.src) || null,
          category: (wp.categories?.[0]?.name || wp._parentCategories?.[0]?.name) || null,
        };

        if (existing) {
          await storage.updateProduct(existing.id, productData);
          updated++;
        } else {
          await storage.createProduct(productData);
          imported++;
        }
      }

      res.json({ imported, updated, total: allWooProducts.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/delivery-addresses", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const tuesdayFilter = req.query.tuesday as string | undefined;
      const ordersList = await storage.getOrders(from, to);
      let filtered = ordersList;
      if (tuesdayFilter === "true") {
        filtered = ordersList.filter(o => o.isTuesday);
      } else if (tuesdayFilter === "false") {
        filtered = ordersList.filter(o => !o.isTuesday);
      }
      const ordersWithItems = await Promise.all(
        filtered.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);
      // Exclude any order whose items are subscription products (they show via stamped manual orders instead)
      const isSubscriptionItem = (name: string) => SUB_PATTERN.test(name) || WEEKLY_SUB_PATTERN.test(name);
      const isAddDeliveryOnly = (items: { productName: string }[]) =>
        items.length > 0 && items.every(i => i.productName.toLowerCase().includes("add delivery"));
      // Subscription-origin orders count as "website" for reconciliation
      const subscriptionOrderIds = await storage.getSubscriptionOriginOrderIds();
      const addresses = ordersWithItems
        .filter(o =>
          (o.deliveryAddress || o.fulfillmentType === "collection") &&
          !o.items.some(i => isSubscriptionItem(i.productName)) &&
          !isAddDeliveryOnly(o.items)
        )
        .map(o => {
          const fulfillment = (o.fulfillmentType === "delivery" || (!o.fulfillmentType && o.deliveryAddress))
            ? "delivery"
            : "collection";
          // Treat subscription-created orders as website (not custom) for reconciliation
          const effectiveIsManual = o.isManual && !subscriptionOrderIds.has(o.id);
          return {
            id: o.id,
            customerName: o.customerName,
            address: o.deliveryAddress,
            lat: o.deliveryLat ? parseFloat(o.deliveryLat) : null,
            lng: o.deliveryLng ? parseFloat(o.deliveryLng) : null,
            fulfillment: fulfillment as "delivery" | "collection",
            isManual: effectiveIsManual,
          };
        });
      res.json(addresses);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/geocode", async (req, res) => {
    try {
      const { address, orderId } = req.body;
      if (!address) return res.status(400).json({ message: "Address is required" });

      const variants = buildAddressVariants(address);
      let lat: number | null = null;
      let lng: number | null = null;

      for (const variant of variants) {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(variant)}&limit=1`,
          { headers: { "User-Agent": "PartnerPortal/1.0" } }
        );
        const data = await response.json();
        if (data && data.length > 0) {
          lat = parseFloat(data[0].lat);
          lng = parseFloat(data[0].lon);
          break;
        }
        await new Promise(r => setTimeout(r, 1100));
      }

      if (lat !== null && lng !== null && orderId) {
        await storage.updateOrder(parseInt(orderId), {
          deliveryLat: String(lat),
          deliveryLng: String(lng),
        });
      }
      res.json({ lat, lng });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/settings", async (_req, res) => {
    try {
      const settingsMap = await getSettingsMap();
      const safe = {
        ...settingsMap,
        smtp_pass: settingsMap.smtp_pass ? "••••••••" : "",
        stripe_test_secret_key: settingsMap.stripe_test_secret_key ? "••••••••" : "",
        stripe_live_secret_key: settingsMap.stripe_live_secret_key ? "••••••••" : "",
      };
      res.json(safe);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const entries = req.body as Record<string, string>;
      const MASKED = "••••••••";
      for (const [key, value] of Object.entries(entries)) {
        if (!ALLOWED_SETTINGS_KEYS.has(key)) {
          return res.status(400).json({ message: `Unknown setting: ${key}` });
        }
        if ((key === "smtp_pass" || key === "stripe_test_secret_key" || key === "stripe_live_secret_key") && value === MASKED) {
          continue;
        }
        if (key === "sync_interval_minutes") {
          const v = parseInt(String(value));
          if (isNaN(v) || v < MIN_SYNC_INTERVAL || v > MAX_SYNC_INTERVAL) {
            return res.status(400).json({ message: `Sync interval must be between ${MIN_SYNC_INTERVAL} and ${MAX_SYNC_INTERVAL} minutes` });
          }
        }
        if (key === "sync_enabled" && value !== "true" && value !== "false") {
          return res.status(400).json({ message: "sync_enabled must be true or false" });
        }
        if (key.includes("_day")) {
          const v = parseInt(String(value));
          if (isNaN(v) || v < 0 || v > 6) {
            return res.status(400).json({ message: "Day must be 0-6 (Sunday-Saturday)" });
          }
        }
        if (key.includes("_hour")) {
          const v = parseInt(String(value));
          if (isNaN(v) || v < 0 || v > 24) {
            return res.status(400).json({ message: "Hour must be 0-24" });
          }
        }
        await storage.setSetting(key, String(value));
      }
      await startAutoSync();
      const settingsMap = await getSettingsMap();
      const safe = {
        ...settingsMap,
        smtp_pass: settingsMap.smtp_pass ? "••••••••" : "",
        stripe_test_secret_key: settingsMap.stripe_test_secret_key ? "••••••••" : "",
        stripe_live_secret_key: settingsMap.stripe_live_secret_key ? "••••••••" : "",
      };
      res.json(safe);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/settings/test-smtp", async (req, res) => {
    try {
      const { to } = req.body;
      if (!to?.trim()) return res.status(400).json({ message: "Please provide a recipient email address" });

      const transporter = await getSmtpTransporter();
      if (!transporter) return res.status(500).json({ message: "SMTP is not configured — fill in the SMTP settings and save first" });

      const fromEmail = await getSmtpFromEmail();
      const baseUrl = await getPortalBaseUrl();

      await transporter.sendMail({
        from: fromEmail || to.trim(),
        to: to.trim(),
        subject: "Simple Kitchen Prep — SMTP Test",
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #16a34a;">SMTP Test Successful</h2>
          <p>This is a test email from your Simple Kitchen Prep partner portal.</p>
          <p>If you received this, your SMTP settings are working correctly.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">Sent from: ${baseUrl}</p>
        </div>`,
      });

      res.json({ success: true, to: to.trim() });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/orders/export", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const ordersList = await storage.getOrders(from, to);
      const ordersWithItems = await Promise.all(
        ordersList.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);

      const allProductNames = Array.from(
        new Set(ordersWithItems.flatMap(o => o.items.map(i => i.productName)))
      ).sort();

      const rows: any[] = [];
      for (const order of ordersWithItems) {
        const row: any = {
          "Customer": order.customerName,
        };
        for (const name of allProductNames) {
          const qty = order.items.filter(i => i.productName === name).reduce((s, i) => s + i.quantity, 0);
          row[name] = qty > 0 ? qty : "";
        }
        row["Delivery Address"] = order.deliveryAddress || "";
        row["Status"] = order.status;
        rows.push(row);
      }

      const totalsRow: any = { "Customer": "TOTAL" };
      for (const name of allProductNames) {
        let total = 0;
        for (const order of ordersWithItems) {
          total += order.items.filter(i => i.productName === name).reduce((s, i) => s + i.quantity, 0);
        }
        totalsRow[name] = total;
      }
      totalsRow["Delivery Address"] = "";
      totalsRow["Status"] = "";
      rows.push(totalsRow);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);

      const cols = ["Customer", ...allProductNames, "Delivery Address", "Status"];
      ws["!cols"] = cols.map(c => ({ wch: Math.max(c.length, 12) }));

      XLSX.utils.book_append_sheet(wb, ws, "Orders");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const dateLabel = from ? `${from.toISOString().split("T")[0]}` : "all";
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="orders_${dateLabel}.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/orders/labels", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      const tuesdayParam = req.query.tuesday as string | undefined;
      const ordersList = await storage.getOrders(from, to);
      let filteredOrders = ordersList;
      if (tuesdayParam === "true") {
        filteredOrders = ordersList.filter(o => o.isTuesday);
      } else if (tuesdayParam === "false") {
        filteredOrders = ordersList.filter(o => !o.isTuesday);
      }
      const ordersWithItems = await Promise.all(
        filteredOrders.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);

      const subscriptionItemRe = /meal\s+subscription\s*-\s*\d+/i;
      const isAddDeliveryOnlyLabel = (items: { productName: string }[]) =>
        items.length > 0 && items.every(i => i.productName.toLowerCase().includes("add delivery"));
      // Print labels for all orders that are not subscription parent orders and not
      // standalone "Add Delivery" charge orders (collection orders get a label too)
      const labelOrders = ordersWithItems.filter(o =>
        !o.items.some(i => subscriptionItemRe.test(i.productName)) &&
        !isAddDeliveryOnlyLabel(o.items)
      );

      // Exact Avery L7163 measurements
      const MM = 2.83465; // 1 mm in PDF points
      const labelW  = 99.1  * MM;
      const labelH  = 38.1  * MM;
      const cols    = 2;
      const rows    = 7;
      const marginL = 4.65  * MM;   // left margin
      const marginT = 15.15 * MM;   // top margin
      const hGap    = 2.5   * MM;   // horizontal gap between columns
      const vGap    = 0;            // vertical gap between rows
      const padX    = 3.5   * MM;   // inner left/right padding
      const innerW  = labelW - padX * 2;

      const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));

      const pdfReady = new Promise<Buffer>((resolve) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
      });

      let labelIndex = 0;
      for (const order of labelOrders) {
        if (labelIndex % (cols * rows) === 0) {
          doc.addPage();
        }
        const posInPage = labelIndex % (cols * rows);
        const col = posInPage % cols;
        const row = Math.floor(posInPage / cols);
        const labelX = marginL + col * (labelW + hGap);
        const labelY = marginT + row * (labelH + vGap);

        // Clip to label boundary — hard stop for any overflow
        doc.save();
        doc.rect(labelX, labelY, labelW, labelH).clip();

        const isDelivery = order.fulfillmentType === "delivery";
        const tag = `[ ${isDelivery ? "DELIVERY" : "COLLECTION"} ]`;

        // Build item summary text
        const itemSummary: Record<string, number> = {};
        for (const item of order.items) {
          if (item.productName.toLowerCase().includes("add delivery")) continue;
          itemSummary[item.productName] = (itemSummary[item.productName] || 0) + item.quantity;
        }
        const summaryText = Object.entries(itemSummary).map(([n, q]) => `${q} x ${n}`).join(", ");
        const noteText = (order as any).notes ? String((order as any).notes).trim() : "";

        // Pre-measure each section
        const NOTE_FONT_SIZE = 5.5;
        const GAP1 = 1.5;  // gap after name
        const GAP2 = 1.5;  // gap after tag
        const GAP3 = 2;    // gap after address
        const GAP4 = 2;    // gap between items and note

        doc.font("Helvetica-Bold").fontSize(9);
        const nameH = doc.heightOfString(order.customerName, { width: innerW });

        doc.font("Helvetica-Bold").fontSize(7);
        const tagH = doc.heightOfString(tag, { width: innerW });

        doc.font("Helvetica").fontSize(7);
        const addrText = order.deliveryAddress || "";
        const addrH = addrText ? doc.heightOfString(addrText, { width: innerW }) : 0;

        doc.font("Helvetica").fontSize(6.5);
        const itemsH = summaryText ? doc.heightOfString(summaryText, { width: innerW }) : 0;

        doc.font("Helvetica-Oblique").fontSize(NOTE_FONT_SIZE);
        const noteH = noteText ? doc.heightOfString(noteText, { width: innerW, lineBreak: false }) : 0;

        // Total content height — note flows right after items
        const totalContentH =
          nameH + GAP1 +
          tagH  + GAP2 +
          (addrH  > 0 ? addrH  + GAP3 : 0) +
          (itemsH > 0 ? itemsH         : 0) +
          (noteH  > 0 ? GAP4 + noteH   : 0);

        // Vertically center the whole block; never start above top padding
        const minPadY = 2 * MM;
        const startY = Math.max(
          labelY + minPadY,
          labelY + (labelH - totalContentH) / 2
        );

        const cx = labelX + padX; // content x (left edge of content area)
        const opts = { width: innerW, align: "center" as const };

        let cy = startY;

        // Name
        doc.font("Helvetica-Bold").fontSize(9);
        doc.text(order.customerName, cx, cy, { ...opts, height: Math.min(nameH, labelH * 0.35) });
        cy = Math.min(doc.y, labelY + labelH * 0.4) + GAP1;

        // Tag
        if (cy < labelY + labelH - 8) {
          doc.font("Helvetica-Bold").fontSize(7);
          doc.text(tag, cx, cy, opts);
          cy = doc.y + GAP2;
        }

        // Address
        if (addrText && cy < labelY + labelH - 10) {
          doc.font("Helvetica").fontSize(7);
          const afterAddr = (itemsH > 0 ? GAP3 + itemsH : 0) + (noteH > 0 ? GAP4 + noteH : 0) + 4;
          const maxAddrH = labelY + labelH - cy - afterAddr;
          if (maxAddrH > 7) {
            doc.text(addrText, cx, cy, { ...opts, height: maxAddrH, ellipsis: true });
            cy = doc.y + GAP3;
          }
        }

        // Items
        if (summaryText && cy < labelY + labelH - 6) {
          doc.font("Helvetica").fontSize(6.5);
          const maxItemH = labelY + labelH - cy - (noteH > 0 ? GAP4 + noteH : 0) - 2;
          doc.text(summaryText, cx, cy, { ...opts, height: maxItemH, ellipsis: true });
          cy = doc.y;
        }

        // Notes — small italic red text flowing directly below items
        if (noteText && cy < labelY + labelH - 3) {
          cy += GAP4;
          doc.font("Helvetica-Oblique").fontSize(NOTE_FONT_SIZE).fillColor("red");
          const maxNoteH = labelY + labelH - cy - 1;
          if (maxNoteH > 4) {
            doc.text(noteText, cx, cy, { ...opts, lineBreak: false, ellipsis: true, height: maxNoteH });
          }
          doc.fillColor("black");
        }

        doc.restore();
        labelIndex++;
      }

      doc.end();
      const pdfBuf = await pdfReady;

      const dateLabel = from ? `${from.toISOString().split("T")[0]}` : "all";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="labels_${dateLabel}.pdf"`);
      res.send(pdfBuf);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/settings/logo", upload.single("logo"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
      await storage.setSetting("logo", base64);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/settings/logo", async (_req, res) => {
    try {
      const logo = await storage.getSetting("logo");
      if (!logo) {
        return res.status(404).json({ message: "No logo set" });
      }
      res.json({ logo });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/settings/logo", async (_req, res) => {
    try {
      await storage.setSetting("logo", "");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/subscription-invites/send", async (req, res) => {
    try {
      const transporter = await getSmtpTransporter();
      if (!transporter) {
        return res.status(500).json({ message: "SMTP not configured" });
      }
      const fromEmail = await getSmtpFromEmail();
      const baseUrl = await getPortalBaseUrl();
      const { overrideEmail } = req.body;
      const week = getWeekRange(0);

      const ordersList = await storage.getOrders(week.from, week.to);
      const ordersWithItems = await Promise.all(
        ordersList.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );

      const subOrders = ordersWithItems.filter(o => o.items.some(i => SUB_PATTERN.test(i.productName) || WEEKLY_SUB_PATTERN.test(i.productName)));

      if (subOrders.length === 0) {
        return res.json({ sent: 0, message: "No subscription orders found this week" });
      }

      const existingInvites = await storage.getSubscriptionInvites(week.from, week.to);
      const alreadyInvitedKeys = new Set(existingInvites.map(i => (i as any).isDual ? `${i.orderId}-dual` : `${i.orderId}-${i.isTuesday}`));

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];
      const settingsMap = await getSettingsMap();
      const emailSubject = settingsMap.subscription_email_subject || DEFAULT_EMAIL_SUBJECT;
      const emailBodyTemplate = settingsMap.subscription_email_body || DEFAULT_EMAIL_BODY;

      for (const order of subOrders) {
        const slots = getSubscriptionSlots(order);
        for (const slot of slots) {
          const key = slot.isDual ? `${order.id}-dual` : `${order.id}-${slot.isTuesday}`;
          if (alreadyInvitedKeys.has(key)) {
            skipped++;
            continue;
          }

          const token = crypto.randomBytes(32).toString("hex");
          let inviteAddress = order.deliveryAddress || null;
          let inviteFulfillment = order.fulfillmentType || "delivery";
          if (!inviteAddress) {
            const pastAddr = await storage.getCustomerDeliveryAddress(order.customerEmail || "", order.customerName);
            if (pastAddr?.deliveryAddress) {
              inviteAddress = pastAddr.deliveryAddress;
              inviteFulfillment = pastAddr.fulfillmentType || "delivery";
            }
          }
          await storage.createSubscriptionInvite({
            orderId: order.id,
            customerEmail: order.customerEmail || "",
            customerName: order.customerName,
            token,
            subscriptionQuantity: slot.qty,
            status: "pending",
            weekFrom: week.from,
            weekTo: week.to,
            deliveryAddress: inviteAddress,
            fulfillmentType: inviteFulfillment,
            isTuesday: slot.isTuesday,
            isDual: slot.isDual,
          } as any);
          alreadyInvitedKeys.add(key);

          const toEmail = overrideEmail || order.customerEmail;
          if (!toEmail) {
            errors.push(`No email for ${order.customerName}`);
            continue;
          }

          const selectUrl = `${baseUrl}/subscribe/${token}`;
          const firstName = order.customerName.split(" ")[0];
          const dayLabel = slot.isDual ? " (Sat + Tue)" : (slot.isTuesday ? " (Tuesday)" : " (Saturday)");
          const emailBody = emailBodyTemplate
            .replace(/\{\{firstName\}\}/g, firstName)
            .replace(/\{\{fullName\}\}/g, order.customerName)
            .replace(/\{\{qty\}\}/g, String(slot.qty))
            .replace(/\{\{url\}\}/g, selectUrl);
          const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${emailBody}</div>`;

          try {
            await transporter.sendMail({
              from: fromEmail,
              to: toEmail,
              subject: (emailSubject
                .replace(/\{\{firstName\}\}/g, firstName)
                .replace(/\{\{fullName\}\}/g, order.customerName)
                .replace(/\{\{qty\}\}/g, String(slot.qty))) + (slots.length > 1 || slot.isDual ? dayLabel : ""),
              html: emailHtml,
            });
            sent++;
          } catch (emailErr: any) {
            errors.push(`Failed to email ${order.customerName}: ${(emailErr as Error).message}`);
          }
        }
      }

      res.json({ sent, total: subOrders.length, skipped, errors });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/subscription-invites", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;

      // Auto-create invite records (no email) for any subscription orders this week
      // that don't have an invite yet, so admin can manage them immediately.
      const week = getWeekRange(0);
      const weekOrders = await storage.getOrders(week.from, week.to);
      const weekOrdersWithItems = await Promise.all(
        weekOrders.map(async (o) => ({ ...o, items: await storage.getOrderItems(o.id) }))
      );
      const subOrders = weekOrdersWithItems.filter(o =>
        o.items.some(i => SUB_PATTERN.test(i.productName) || WEEKLY_SUB_PATTERN.test(i.productName))
      );
      const existingThisWeek = await storage.getSubscriptionInvites(week.from, week.to);
      const existingKeys = new Set(existingThisWeek.map(i =>
        (i as any).isDual ? `${i.orderId}-dual` : `${i.orderId}-${i.isTuesday}`
      ));
      for (const order of subOrders) {
        const slots = getSubscriptionSlots(order);
        for (const slot of slots) {
          const key = slot.isDual ? `${order.id}-dual` : `${order.id}-${slot.isTuesday}`;
          if (existingKeys.has(key)) continue;
          const token = crypto.randomBytes(32).toString("hex");
          let inviteAddress = order.deliveryAddress || null;
          let inviteFulfillment = order.fulfillmentType || "delivery";
          if (!inviteAddress && order.customerEmail) {
            const pastAddr = await storage.getCustomerDeliveryAddress(order.customerEmail, order.customerName);
            if (pastAddr?.deliveryAddress) { inviteAddress = pastAddr.deliveryAddress; inviteFulfillment = pastAddr.fulfillmentType || "delivery"; }
          }
          await storage.createSubscriptionInvite({
            orderId: order.id,
            customerEmail: order.customerEmail || "",
            customerName: order.customerName,
            token,
            subscriptionQuantity: slot.qty,
            status: "pending",
            weekFrom: week.from,
            weekTo: week.to,
            deliveryAddress: inviteAddress,
            fulfillmentType: inviteFulfillment,
            isTuesday: slot.isTuesday,
            isDual: slot.isDual,
          } as any);
          existingKeys.add(key);
        }
      }

      const invites = await storage.getSubscriptionInvites(from, to);
      const allProducts = await storage.getProducts();
      const productPriceByName = new Map<string, number>();
      for (const p of allProducts) {
        const price = parseFloat(p.price || "0");
        productPriceByName.set(p.name.toLowerCase(), price);
      }
      const STANDARD_PRICE = 7.75;
      const result = await Promise.all(
        invites.map(async (invite) => {
          const selections = await storage.getSubscriptionSelections(invite.id);
          let computedAddonAmountPence = 0;
          for (const sel of selections) {
            const price = productPriceByName.get(sel.productName.toLowerCase());
            if (price !== undefined && price !== STANDARD_PRICE) {
              computedAddonAmountPence += Math.round(price * 100) * sel.quantity;
            }
          }
          return { ...invite, selections, computedAddonAmountPence };
        })
      );
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/subscribe/:token", async (req, res) => {
    try {
      const invite = await storage.getSubscriptionInviteByToken(req.params.token);
      if (!invite) {
        return res.status(404).json({ message: "Invitation not found or expired" });
      }

      // Use the invite's weekFrom to determine which week's products to show —
      // so a late click never shows the next week's menu.
      const inviteWeekDate = invite.weekFrom ? new Date(invite.weekFrom) : undefined;
      const { weekNumber, categoryName } = await getCurrentWeekInfo(inviteWeekDate);
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);

      let availableMeals: Array<{ name: string; popularity: number }>;
      let availableExtras: Array<{ name: string; popularity: number }>;

      // Build a price map: product name -> price string from products DB
      const extraPriceMap: Record<string, string> = {};
      for (const p of allProducts) {
        extraPriceMap[p.name] = p.price || "0";
      }

      const SKIP_PAT = /subscription|add\s+delivery/i;
      const productPool = weekProducts.length > 0 ? weekProducts : allProducts.filter(p => !SKIP_PAT.test(p.name));
      // Meals: strictly this week's category only
      availableMeals = productPool
        .filter(p => !SKIP_PAT.test(p.name) && Math.abs(parseFloat(p.price || "0") - 7.75) < 0.01)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({ name: p.name, popularity: 0, price: p.price || "7.75" }));
      availableExtras = productPool
        .filter(p => { if (SKIP_PAT.test(p.name)) return false; const pr = parseFloat(p.price || "0"); return pr > 0 && Math.abs(pr - 7.75) >= 0.01; })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({ name: p.name, popularity: 0, price: p.price || "0" }));

      const existingSelections = await storage.getSubscriptionSelections(invite.id);
      const isDual = (invite as any).isDual === true;

      res.json({
        customerName: invite.customerName,
        subscriptionQuantity: invite.subscriptionQuantity,
        status: invite.status,
        addonPaid: invite.addonPaid,
        addonAmountPence: invite.addonAmountPence,
        isTuesday: invite.isTuesday,
        isDual,
        weekNumber,
        categoryName,
        availableMeals,
        availableExtras,
        selections: existingSelections,
        satSelections: isDual ? existingSelections.filter((s: any) => (s.deliveryDay || 'sat') === 'sat') : existingSelections,
        tueSelections: isDual ? existingSelections.filter((s: any) => s.deliveryDay === 'tue') : [],
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/subscribe/:token", async (req, res) => {
    try {
      const invite = await storage.getSubscriptionInviteByToken(req.params.token);
      if (!invite) {
        return res.status(404).json({ message: "Invitation not found" });
      }

      if (invite.status === "completed") {
        return res.status(400).json({ message: "You have already submitted your meal choices" });
      }

      const isDual = (invite as any).isDual === true;
      const { email, selections, extras, satSelections, tueSelections, satExtras, tueExtras } = req.body;
      if (!email || typeof email !== "string" || email.toLowerCase() !== invite.customerEmail.toLowerCase()) {
        return res.status(403).json({ message: "Email does not match the subscription order" });
      }

      // Look up prices for extras from products DB
      const allProductsList = await storage.getProducts();
      const productPriceMap: Record<string, string> = {};
      for (const p of allProductsList) {
        productPriceMap[p.name] = p.price || "0";
      }

      if (isDual) {
        // ---- DUAL DAY (Saturday + Tuesday) ----
        const satSels: any[] = Array.isArray(satSelections) ? satSelections : [];
        const tueSels: any[] = Array.isArray(tueSelections) ? tueSelections : [];
        if (satSels.length === 0 || tueSels.length === 0) {
          return res.status(400).json({ message: "Please select meals for both Saturday and Tuesday deliveries" });
        }
        const satExtList: any[] = Array.isArray(satExtras) ? satExtras : [];
        const tueExtList: any[] = Array.isArray(tueExtras) ? tueExtras : [];

        const satTotalQty = satSels.reduce((sum: number, s: any) => sum + parseInt(s.quantity, 10), 0);
        const tueTotalQty = tueSels.reduce((sum: number, s: any) => sum + parseInt(s.quantity, 10), 0);
        if (satTotalQty > invite.subscriptionQuantity) {
          return res.status(400).json({ message: `Saturday: you can select up to ${invite.subscriptionQuantity} meals` });
        }
        if (tueTotalQty > invite.subscriptionQuantity) {
          return res.status(400).json({ message: `Tuesday: you can select up to ${invite.subscriptionQuantity} meals` });
        }

        // Resolve address
        let resolvedAddress = invite.deliveryAddress || null;
        let resolvedFulfillment = invite.fulfillmentType || "delivery";
        if (!resolvedAddress) {
          const pastAddr = await storage.getCustomerDeliveryAddress(invite.customerEmail || "", invite.customerName);
          if (pastAddr?.deliveryAddress) {
            resolvedAddress = pastAddr.deliveryAddress;
            resolvedFulfillment = pastAddr.fulfillmentType || "delivery";
          }
        }

        // Save all selections with deliveryDay tag
        await storage.deleteSubscriptionSelectionsByInviteId(invite.id);
        for (const sel of [...satSels, ...satExtList]) {
          await storage.createSubscriptionSelection({
            inviteId: invite.id,
            productName: sel.productName,
            quantity: parseInt(sel.quantity, 10),
            deliveryDay: 'sat',
          } as any);
        }
        for (const sel of [...tueSels, ...tueExtList]) {
          await storage.createSubscriptionSelection({
            inviteId: invite.id,
            productName: sel.productName,
            quantity: parseInt(sel.quantity, 10),
            deliveryDay: 'tue',
          } as any);
        }

        // Create Saturday order
        const satOrder = await storage.createOrder({
          customerName: invite.customerName,
          customerEmail: invite.customerEmail,
          deliveryAddress: resolvedAddress,
          orderDate: invite.weekFrom,
          status: "processing",
          fulfillmentType: resolvedFulfillment as "delivery" | "collection",
          isManual: true,
          isTuesday: false,
        });
        for (const sel of satSels) {
          await storage.createOrderItem({ orderId: satOrder.id, productId: null, productName: sel.productName, quantity: parseInt(sel.quantity, 10), price: "7.75" });
        }
        for (const ext of satExtList) {
          if (!ext.productName?.trim()) continue;
          const qty = parseInt(ext.quantity, 10) || 1;
          const price = parseFloat(productPriceMap[ext.productName] || "0");
          await storage.createOrderItem({ orderId: satOrder.id, productId: null, productName: ext.productName, quantity: qty, price: price > 0 ? String(price) : "0" });
        }

        // Create Tuesday order
        const tueOrder = await storage.createOrder({
          customerName: invite.customerName,
          customerEmail: invite.customerEmail,
          deliveryAddress: resolvedAddress,
          orderDate: invite.weekFrom,
          status: "processing",
          fulfillmentType: resolvedFulfillment as "delivery" | "collection",
          isManual: true,
          isTuesday: true,
        });
        for (const sel of tueSels) {
          await storage.createOrderItem({ orderId: tueOrder.id, productId: null, productName: sel.productName, quantity: parseInt(sel.quantity, 10), price: "7.75" });
        }
        for (const ext of tueExtList) {
          if (!ext.productName?.trim()) continue;
          const qty = parseInt(ext.quantity, 10) || 1;
          const price = parseFloat(productPriceMap[ext.productName] || "0");
          await storage.createOrderItem({ orderId: tueOrder.id, productId: null, productName: ext.productName, quantity: qty, price: price > 0 ? String(price) : "0" });
        }

        await storage.updateSubscriptionInviteStatus(invite.id, "completed");
        await storage.setSubscriptionInviteSelectionsOrder(invite.id, satOrder.id);
        await storage.setSubscriptionInviteTuesdayOrder(invite.id, tueOrder.id);

        return res.json({ success: true, orderId: satOrder.id, tuesdayOrderId: tueOrder.id });
      }

      // ---- SINGLE DAY (original logic) ----
      if (!Array.isArray(selections) || selections.length === 0) {
        return res.status(400).json({ message: "Please select at least one meal" });
      }

      for (const sel of selections) {
        if (!sel.productName || typeof sel.productName !== "string") {
          return res.status(400).json({ message: "Invalid meal selection" });
        }
        const qty = parseInt(sel.quantity, 10);
        if (isNaN(qty) || qty < 1) {
          return res.status(400).json({ message: "Invalid quantity" });
        }
      }

      const totalQty = selections.reduce((sum: number, s: any) => sum + parseInt(s.quantity, 10), 0);
      if (totalQty > invite.subscriptionQuantity) {
        return res.status(400).json({ message: `You can select up to ${invite.subscriptionQuantity} meals` });
      }

      const extrasList: any[] = Array.isArray(extras) ? extras : [];

      // Calculate addon cost: sum of extra items at their WooCommerce price
      let addonAmountPence = 0;
      const addonLineItems: Array<{ name: string; pricePence: number; quantity: number }> = [];
      for (const extra of extrasList) {
        if (!extra.productName?.trim()) continue;
        const qty = parseInt(extra.quantity, 10) || 1;
        const unitPrice = parseFloat(productPriceMap[extra.productName] || "0");
        if (unitPrice > 0) {
          const pricePence = Math.round(unitPrice * 100);
          addonAmountPence += pricePence * qty;
          addonLineItems.push({ name: extra.productName, pricePence, quantity: qty });
        }
      }

      await storage.deleteSubscriptionSelectionsByInviteId(invite.id);
      for (const sel of [...selections, ...extrasList]) {
        await storage.createSubscriptionSelection({
          inviteId: invite.id,
          productName: sel.productName,
          quantity: parseInt(sel.quantity, 10),
          deliveryDay: invite.isTuesday ? 'tue' : 'sat',
        } as any);
      }

      // Resolve address: use invite address, or fall back to customer's order history
      let resolvedAddress = invite.deliveryAddress || null;
      let resolvedFulfillment = invite.fulfillmentType || "delivery";
      if (!resolvedAddress) {
        const pastAddr = await storage.getCustomerDeliveryAddress(
          invite.customerEmail || "",
          invite.customerName
        );
        if (pastAddr?.deliveryAddress) {
          resolvedAddress = pastAddr.deliveryAddress;
          resolvedFulfillment = pastAddr.fulfillmentType || "delivery";
        }
      }

      const order = await storage.createOrder({
        customerName: invite.customerName,
        customerEmail: invite.customerEmail,
        deliveryAddress: resolvedAddress,
        orderDate: invite.weekFrom,
        status: "processing",
        fulfillmentType: resolvedFulfillment as "delivery" | "collection",
        isManual: true,
        isTuesday: invite.isTuesday ?? false,
      });

      for (const sel of selections) {
        await storage.createOrderItem({
          orderId: order.id,
          productId: null,
          productName: sel.productName,
          quantity: parseInt(sel.quantity, 10),
          price: "7.75",
        });
      }
      for (const extra of extrasList) {
        if (!extra.productName?.trim()) continue;
        const qty = parseInt(extra.quantity, 10) || 1;
        const unitPrice = parseFloat(productPriceMap[extra.productName] || "0");
        await storage.createOrderItem({
          orderId: order.id,
          productId: null,
          productName: extra.productName,
          quantity: qty,
          price: unitPrice > 0 ? String(unitPrice) : "0",
        });
      }

      await storage.updateSubscriptionInviteStatus(invite.id, "completed");
      await storage.setSubscriptionInviteSelectionsOrder(invite.id, order.id);

      // If there are paid addons, create a Stripe Checkout session
      if (addonAmountPence >= 50) {
        try {
          const baseUrl = await getPortalBaseUrl();
          const stripe = await getUncachableStripeClient(await getActiveStripeSecretKey());
          const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: addonLineItems.map(item => ({
              price_data: {
                currency: "gbp",
                unit_amount: item.pricePence,
                product_data: { name: item.name },
              },
              quantity: item.quantity,
            })),
            mode: "payment",
            customer_email: invite.customerEmail || undefined,
            success_url: `${baseUrl}/subscribe/${invite.token}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${baseUrl}/subscribe/${invite.token}`,
            metadata: {
              inviteId: String(invite.id),
              customerName: invite.customerName,
              orderId: String(order.id),
            },
          });
          await storage.updateSubscriptionInvitePayment(invite.id, {
            addonAmountPence,
            addonPaid: false,
            addonPaymentToken: session.id,
          });
          return res.json({ success: true, orderId: order.id, checkoutUrl: session.url });
        } catch (stripeError: any) {
          log(`Stripe checkout creation failed: ${stripeError.message}`);
          // Fall through and complete without payment link
        }
      } else if (addonAmountPence > 0) {
        await storage.updateSubscriptionInvitePayment(invite.id, {
          addonAmountPence,
          addonPaid: false,
        });
      }

      res.json({ success: true, orderId: order.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/subscription-invites/:id/meals", async (req, res) => {
    try {
      const invite = await storage.getSubscriptionInviteById(parseInt(req.params.id));
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      // Anchor product pool to the invite's own week, not today
      const inviteWeekDate = invite.weekFrom ? new Date(invite.weekFrom) : undefined;
      const { weekNumber, categoryName } = await getCurrentWeekInfo(inviteWeekDate);
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);

      let availableMeals: Array<{ name: string; popularity: number }>;
      let availableExtras: Array<{ name: string; popularity: number }>;

      const SKIP_PAT = /subscription|add\s+delivery/i;
      const productPool = weekProducts.length > 0 ? weekProducts : allProducts.filter(p => !SKIP_PAT.test(p.name));
      // Meals: strictly this week's category only
      availableMeals = productPool
        .filter(p => !SKIP_PAT.test(p.name) && Math.abs(parseFloat(p.price || "0") - 7.75) < 0.01)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({ name: p.name, popularity: 0 }));
      availableExtras = productPool
        .filter(p => { if (SKIP_PAT.test(p.name)) return false; const pr = parseFloat(p.price || "0"); return pr > 0 && Math.abs(pr - 7.75) >= 0.01; })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({ name: p.name, popularity: 0 }));

      const existingSelections = await storage.getSubscriptionSelections(invite.id);
      const isDual = (invite as any).isDual === true;
      res.json({
        customerName: invite.customerName,
        subscriptionQuantity: invite.subscriptionQuantity,
        isTuesday: invite.isTuesday,
        isDual,
        weekNumber,
        categoryName,
        availableMeals,
        availableExtras,
        selections: existingSelections,
        satSelections: isDual ? existingSelections.filter((s: any) => (s.deliveryDay || 'sat') === 'sat') : existingSelections,
        tueSelections: isDual ? existingSelections.filter((s: any) => s.deliveryDay === 'tue') : [],
        tuesdaySelectionsOrderId: (invite as any).tuesdaySelectionsOrderId || null,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/subscription-invites/:id/selections", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invite = await storage.getSubscriptionInviteById(id);
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const { selections, extras, subscriptionQuantity, satSelections, tueSelections, satExtras, tueExtras } = req.body;
      const isDualInvite = (invite as any).isDual === true;

      const effectiveMax = subscriptionQuantity && Number.isInteger(subscriptionQuantity) && subscriptionQuantity > 0
        ? subscriptionQuantity
        : invite.subscriptionQuantity;
      if (effectiveMax !== invite.subscriptionQuantity) {
        await storage.updateSubscriptionInviteQuantity(id, effectiveMax);
      }

      // Backfill address from order history if the invite was created without one
      let resolvedAddress = invite.deliveryAddress || null;
      let resolvedFulfillment = invite.fulfillmentType || "delivery";
      if (!resolvedAddress) {
        const pastAddr = await storage.getCustomerDeliveryAddress(invite.customerEmail || "", invite.customerName);
        if (pastAddr?.deliveryAddress) {
          resolvedAddress = pastAddr.deliveryAddress;
          resolvedFulfillment = pastAddr.fulfillmentType || "delivery";
        }
      }

      if (isDualInvite) {
        // ---- DUAL: handle satSelections + tueSelections ----
        const satSels: any[] = Array.isArray(satSelections) ? satSelections : (Array.isArray(selections) ? selections : []);
        const tueSels: any[] = Array.isArray(tueSelections) ? tueSelections : [];
        const satExtList: any[] = Array.isArray(satExtras) ? satExtras : (Array.isArray(extras) ? extras : []);
        const tueExtList: any[] = Array.isArray(tueExtras) ? tueExtras : [];

        if (satSels.length === 0 || tueSels.length === 0) {
          return res.status(400).json({ message: "Please select meals for both Saturday and Tuesday deliveries" });
        }

        await storage.deleteSubscriptionSelectionsByInviteId(id);
        for (const sel of [...satSels, ...satExtList]) {
          if (!sel.productName?.trim()) continue;
          await storage.createSubscriptionSelection({ inviteId: id, productName: sel.productName, quantity: parseInt(sel.quantity, 10) || 1, deliveryDay: 'sat' } as any);
        }
        for (const sel of [...tueSels, ...tueExtList]) {
          if (!sel.productName?.trim()) continue;
          await storage.createSubscriptionSelection({ inviteId: id, productName: sel.productName, quantity: parseInt(sel.quantity, 10) || 1, deliveryDay: 'tue' } as any);
        }

        // Update or create Saturday order
        if (invite.selectionsOrderId) {
          await storage.updateOrder(invite.selectionsOrderId, { orderDate: invite.weekFrom, deliveryAddress: resolvedAddress, fulfillmentType: resolvedFulfillment as "delivery" | "collection" });
          await storage.deleteOrderItemsByOrderId(invite.selectionsOrderId);
          for (const sel of satSels) { if (!sel.productName?.trim()) continue; await storage.createOrderItem({ orderId: invite.selectionsOrderId!, productId: null, productName: sel.productName, quantity: parseInt(sel.quantity, 10) || 1, price: "7.75" }); }
          for (const ext of satExtList) { if (!ext.productName?.trim()) continue; await storage.createOrderItem({ orderId: invite.selectionsOrderId!, productId: null, productName: ext.productName, quantity: parseInt(ext.quantity, 10) || 1, price: "0" }); }
        } else {
          const satOrder = await storage.createOrder({ customerName: invite.customerName, customerEmail: invite.customerEmail, deliveryAddress: resolvedAddress, orderDate: invite.weekFrom, status: "processing", fulfillmentType: resolvedFulfillment as "delivery" | "collection", isManual: true, isTuesday: false });
          for (const sel of satSels) { if (!sel.productName?.trim()) continue; await storage.createOrderItem({ orderId: satOrder.id, productId: null, productName: sel.productName, quantity: parseInt(sel.quantity, 10) || 1, price: "7.75" }); }
          for (const ext of satExtList) { if (!ext.productName?.trim()) continue; await storage.createOrderItem({ orderId: satOrder.id, productId: null, productName: ext.productName, quantity: parseInt(ext.quantity, 10) || 1, price: "0" }); }
          await storage.setSubscriptionInviteSelectionsOrder(id, satOrder.id);
        }

        // Update or create Tuesday order
        const tueOrderId = (invite as any).tuesdaySelectionsOrderId as number | null;
        if (tueOrderId) {
          await storage.updateOrder(tueOrderId, { orderDate: invite.weekFrom, deliveryAddress: resolvedAddress, fulfillmentType: resolvedFulfillment as "delivery" | "collection" });
          await storage.deleteOrderItemsByOrderId(tueOrderId);
          for (const sel of tueSels) { if (!sel.productName?.trim()) continue; await storage.createOrderItem({ orderId: tueOrderId, productId: null, productName: sel.productName, quantity: parseInt(sel.quantity, 10) || 1, price: "7.75" }); }
          for (const ext of tueExtList) { if (!ext.productName?.trim()) continue; await storage.createOrderItem({ orderId: tueOrderId, productId: null, productName: ext.productName, quantity: parseInt(ext.quantity, 10) || 1, price: "0" }); }
        } else {
          const tueOrder = await storage.createOrder({ customerName: invite.customerName, customerEmail: invite.customerEmail, deliveryAddress: resolvedAddress, orderDate: invite.weekFrom, status: "processing", fulfillmentType: resolvedFulfillment as "delivery" | "collection", isManual: true, isTuesday: true });
          for (const sel of tueSels) { if (!sel.productName?.trim()) continue; await storage.createOrderItem({ orderId: tueOrder.id, productId: null, productName: sel.productName, quantity: parseInt(sel.quantity, 10) || 1, price: "7.75" }); }
          for (const ext of tueExtList) { if (!ext.productName?.trim()) continue; await storage.createOrderItem({ orderId: tueOrder.id, productId: null, productName: ext.productName, quantity: parseInt(ext.quantity, 10) || 1, price: "0" }); }
          await storage.setSubscriptionInviteTuesdayOrder(id, tueOrder.id);
        }

        await storage.updateSubscriptionInviteStatus(id, "completed");
        const updatedSelections = await storage.getSubscriptionSelections(id);
        return res.json({ success: true, selections: updatedSelections });
      }

      // ---- SINGLE DAY ----
      if (!Array.isArray(selections) || selections.length === 0) {
        return res.status(400).json({ message: "Please select at least one meal" });
      }

      // Only meal selections count against the quota; extras are free
      const totalQty = selections.reduce((sum: number, s: any) => sum + (parseInt(s.quantity, 10) || 0), 0);
      if (totalQty > effectiveMax) {
        return res.status(400).json({ message: `Maximum ${effectiveMax} meals allowed` });
      }

      const extrasList: any[] = Array.isArray(extras) ? extras : [];
      const allSelections = [...selections, ...extrasList];

      await storage.deleteSubscriptionSelectionsByInviteId(id);
      for (const sel of allSelections) {
        if (!sel.productName?.trim()) continue;
        await storage.createSubscriptionSelection({
          inviteId: id,
          productName: sel.productName,
          quantity: parseInt(sel.quantity, 10) || 1,
          deliveryDay: invite.isTuesday ? 'tue' : 'sat',
        } as any);
      }

      if (invite.selectionsOrderId) {
        // Ensure the order date and delivery details are correct (fix any legacy wrong-date orders)
        await storage.updateOrder(invite.selectionsOrderId, {
          orderDate: invite.weekFrom,
          deliveryAddress: resolvedAddress,
          fulfillmentType: resolvedFulfillment as "delivery" | "collection",
        });
        await storage.deleteOrderItemsByOrderId(invite.selectionsOrderId);
        for (const sel of selections) {
          if (!sel.productName?.trim()) continue;
          await storage.createOrderItem({
            orderId: invite.selectionsOrderId,
            productId: null,
            productName: sel.productName,
            quantity: parseInt(sel.quantity, 10) || 1,
            price: "7.75",
          });
        }
        for (const extra of extrasList) {
          if (!extra.productName?.trim()) continue;
          await storage.createOrderItem({
            orderId: invite.selectionsOrderId,
            productId: null,
            productName: extra.productName,
            quantity: parseInt(extra.quantity, 10) || 1,
            price: "0",
          });
        }
      } else {
        const order = await storage.createOrder({
          customerName: invite.customerName,
          customerEmail: invite.customerEmail,
          deliveryAddress: invite.deliveryAddress || null,
          orderDate: invite.weekFrom,
          status: "processing",
          fulfillmentType: (invite.fulfillmentType as "delivery" | "collection") || "delivery",
          isManual: true,
        });
        for (const sel of selections) {
          if (!sel.productName?.trim()) continue;
          await storage.createOrderItem({
            orderId: order.id,
            productId: null,
            productName: sel.productName,
            quantity: parseInt(sel.quantity, 10) || 1,
            price: "7.75",
          });
        }
        for (const extra of extrasList) {
          if (!extra.productName?.trim()) continue;
          await storage.createOrderItem({
            orderId: order.id,
            productId: null,
            productName: extra.productName,
            quantity: parseInt(extra.quantity, 10) || 1,
            price: "0",
          });
        }
        await storage.setSubscriptionInviteSelectionsOrder(id, order.id);
      }

      await storage.updateSubscriptionInviteStatus(id, "completed");
      const updatedSelections = await storage.getSubscriptionSelections(id);
      res.json({ success: true, selections: updatedSelections });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/subscription-invites/:id/resend", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invite = await storage.getSubscriptionInviteById(id);
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const transporter = await getSmtpTransporter();
      if (!transporter) return res.status(500).json({ message: "SMTP not configured" });

      const baseUrl = await getPortalBaseUrl();
      const fromEmail = await getSmtpFromEmail();
      const settingsMap = await getSettingsMap();
      const emailSubject = settingsMap.subscription_email_subject || DEFAULT_EMAIL_SUBJECT;
      const emailBodyTemplate = settingsMap.subscription_email_body || DEFAULT_EMAIL_BODY;

      const { overrideEmail } = req.body;
      const toEmail = overrideEmail?.trim() || invite.customerEmail;
      if (!toEmail) return res.status(400).json({ message: "No email address for this invite" });

      const selectUrl = `${baseUrl}/subscribe/${invite.token}`;
      const firstName = invite.customerName.split(" ")[0];
      const qty = invite.subscriptionQuantity;

      const emailBody = emailBodyTemplate
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{fullName\}\}/g, invite.customerName)
        .replace(/\{\{qty\}\}/g, String(qty))
        .replace(/\{\{url\}\}/g, selectUrl);
      const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${emailBody}</div>`;

      await transporter.sendMail({
        from: fromEmail,
        to: toEmail,
        subject: emailSubject
          .replace(/\{\{firstName\}\}/g, firstName)
          .replace(/\{\{fullName\}\}/g, invite.customerName)
          .replace(/\{\{qty\}\}/g, String(qty)),
        html: emailHtml,
      });

      res.json({ success: true, to: toEmail });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Re-issue payment receipt email ────────────────────────────────────────
  app.post("/api/subscription-invites/:id/resend-receipt", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invite = await storage.getSubscriptionInviteById(id);
      if (!invite) return res.status(404).json({ message: "Invite not found" });
      if (!invite.addonPaid) return res.status(400).json({ message: "No payment recorded for this invite" });
      if (!invite.customerEmail) return res.status(400).json({ message: "No email address for this customer" });

      const transporter = await getSmtpTransporter();
      if (!transporter) return res.status(500).json({ message: "SMTP not configured" });
      const fromEmail = await getSmtpFromEmail();
      if (!fromEmail) return res.status(500).json({ message: "SMTP from address not configured" });

      const selections = await storage.getSubscriptionSelections(id);
      const firstName = invite.customerName.split(" ")[0];
      const amountPence = invite.addonAmountPence ?? 0;
      const amountFormatted = `£${(amountPence / 100).toFixed(2)}`;

      const itemRows = selections.length > 0
        ? selections.map(sel => `<tr>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;">${sel.productName}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center;">${sel.quantity}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">—</td>
          </tr>`).join("")
        : `<tr><td colspan="3" style="padding:6px 12px;">Add-on extras</td></tr>`;

      const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
  <h2 style="color:#059669;">Payment Receipt – Simple Kitchen Prep</h2>
  <p>Hi ${firstName},</p>
  <p>Here is a copy of your receipt for your add-on extras this week.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:8px 12px;text-align:left;">Item</th>
        <th style="padding:8px 12px;text-align:center;">Qty</th>
        <th style="padding:8px 12px;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="padding:8px 12px;font-weight:bold;text-align:right;">Total paid:</td>
        <td style="padding:8px 12px;font-weight:bold;text-align:right;">${amountFormatted}</td>
      </tr>
    </tfoot>
  </table>
  <p style="color:#6b7280;font-size:13px;">Your meals will be ready for collection/delivery as usual this week. If you have any questions, just reply to this email.</p>
  <p style="color:#6b7280;font-size:13px;">— Simple Kitchen Prep</p>
</div>`;

      await transporter.sendMail({
        from: fromEmail,
        to: invite.customerEmail,
        subject: `Payment Receipt – ${amountFormatted} – Simple Kitchen Prep`,
        html,
      });

      res.json({ success: true, to: invite.customerEmail });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Reset subscription invite: wipe selections + resend email ─────────────
  app.post("/api/subscription-invites/:id/reset", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invite = await storage.getSubscriptionInviteById(id);
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const { deletedOrderId } = await storage.resetSubscriptionInvite(id);

      // Resend the invite email
      let emailSent = false;
      const transporter = await getSmtpTransporter();
      if (transporter) {
        const baseUrl = await getPortalBaseUrl();
        const fromEmail = await getSmtpFromEmail();
        const settingsMap = await getSettingsMap();
        const emailSubject = settingsMap.subscription_email_subject || DEFAULT_EMAIL_SUBJECT;
        const emailBodyTemplate = settingsMap.subscription_email_body || DEFAULT_EMAIL_BODY;

        const toEmail = invite.customerEmail;
        if (toEmail) {
          const selectUrl = `${baseUrl}/subscribe/${invite.token}`;
          const firstName = invite.customerName.split(" ")[0];
          const qty = invite.subscriptionQuantity;
          const emailBody = emailBodyTemplate
            .replace(/\{\{firstName\}\}/g, firstName)
            .replace(/\{\{fullName\}\}/g, invite.customerName)
            .replace(/\{\{qty\}\}/g, String(qty))
            .replace(/\{\{url\}\}/g, selectUrl);
          const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${emailBody}</div>`;

          await transporter.sendMail({
            from: fromEmail,
            to: toEmail,
            subject: emailSubject
              .replace(/\{\{firstName\}\}/g, firstName)
              .replace(/\{\{fullName\}\}/g, invite.customerName)
              .replace(/\{\{qty\}\}/g, String(qty)),
            html: emailHtml,
          });
          emailSent = true;
        }
      }

      res.json({ success: true, emailSent, deletedOrderId });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/subscription-invites/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invite = await storage.getSubscriptionInviteById(id);
      if (!invite) return res.status(404).json({ message: "Invite not found" });
      await storage.deleteSubscriptionInvite(id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Returns the most recent website (WooCommerce) order + items for each recurring customer,
  // keyed by recurringOrder.id. Used to preview "last order" in the templates table.
  app.get("/api/recurring-orders/previous-orders", async (req, res) => {
    try {
      const recurringList = await storage.getRecurringOrders();

      // All orders (including manual stamps), newest-first
      const allOrders = await storage.getOrders();
      const sorted = [...allOrders]
        .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

      // Map customerName (lowercase) → most recent order
      const byCustomer = new Map<string, typeof sorted[0]>();
      for (const o of sorted) {
        const key = o.customerName.toLowerCase().trim();
        if (!byCustomer.has(key)) byCustomer.set(key, o);
      }

      const result: Record<number, { items: { productName: string; quantity: number }[]; orderDate: string }> = {};
      for (const ro of recurringList) {
        const last = byCustomer.get(ro.customerName.toLowerCase().trim());
        if (last) {
          const items = await storage.getOrderItems(last.id);
          result[ro.id] = {
            items: items.map(i => ({ productName: i.productName, quantity: i.quantity })),
            orderDate: last.orderDate instanceof Date ? last.orderDate.toISOString() : String(last.orderDate),
          };
        }
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/recurring-orders", async (req, res) => {
    try {
      const recurringOrdersList = await storage.getRecurringOrders();
      const result = [];
      for (const ro of recurringOrdersList) {
        const items = await storage.getRecurringOrderItems(ro.id);
        result.push({ ...ro, items });
      }
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/recurring-orders", async (req, res) => {
    try {
      const { items, ...orderData } = req.body;
      if (!orderData.customerName || typeof orderData.customerName !== "string") {
        return res.status(400).json({ message: "Customer name is required" });
      }
      // Prevent duplicates: if same name+day already exists, update instead of create
      const allExisting = await storage.getRecurringOrders();
      const isTuesday = orderData.isTuesday !== false;
      const duplicate = allExisting.find(
        r => r.customerName.toLowerCase().trim() === orderData.customerName.toLowerCase().trim()
          && r.isTuesday === isTuesday
      );
      if (duplicate) {
        const updates: any = {};
        if (orderData.deliveryAddress !== undefined) updates.deliveryAddress = orderData.deliveryAddress || null;
        if (orderData.fulfillmentType !== undefined) updates.fulfillmentType = orderData.fulfillmentType;
        if (orderData.notes !== undefined) updates.notes = orderData.notes || null;
        if (Object.keys(updates).length > 0) await storage.updateRecurringOrder(duplicate.id, updates);
        if (items && Array.isArray(items)) {
          await storage.deleteRecurringOrderItemsByOrderId(duplicate.id);
          for (const item of items) {
            if (item.productName && item.productName.trim()) {
              await storage.createRecurringOrderItem({ recurringOrderId: duplicate.id, productName: item.productName, quantity: item.quantity || 1 });
            }
          }
        }
        const orderItems = await storage.getRecurringOrderItems(duplicate.id);
        return res.json({ ...duplicate, ...updates, items: orderItems });
      }
      const ro = await storage.createRecurringOrder({
        customerName: orderData.customerName,
        deliveryAddress: orderData.deliveryAddress || null,
        fulfillmentType: orderData.fulfillmentType || "delivery",
        active: orderData.active !== false,
        isTuesday: orderData.isTuesday !== false,
        notes: orderData.notes || null,
      });
      if (items && Array.isArray(items)) {
        for (const item of items) {
          if (item.productName && item.productName.trim()) {
            await storage.createRecurringOrderItem({
              recurringOrderId: ro.id,
              productName: item.productName,
              quantity: item.quantity || 1,
            });
          }
        }
      }
      const orderItems = await storage.getRecurringOrderItems(ro.id);
      res.json({ ...ro, items: orderItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/recurring-orders/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await storage.getRecurringOrder(id);
      if (!existing) {
        return res.status(404).json({ message: "Recurring order not found" });
      }
      const { items, ...updates } = req.body;
      const orderUpdate: any = {};
      if (updates.customerName !== undefined) orderUpdate.customerName = updates.customerName;
      if (updates.deliveryAddress !== undefined) orderUpdate.deliveryAddress = updates.deliveryAddress;
      if (updates.fulfillmentType !== undefined) orderUpdate.fulfillmentType = updates.fulfillmentType;
      if (updates.active !== undefined) orderUpdate.active = updates.active;
      if (updates.isTuesday !== undefined) orderUpdate.isTuesday = updates.isTuesday;
      if (updates.notes !== undefined) orderUpdate.notes = updates.notes;

      const updated = Object.keys(orderUpdate).length > 0
        ? await storage.updateRecurringOrder(id, orderUpdate)
        : existing;

      if (items && Array.isArray(items)) {
        await storage.deleteRecurringOrderItemsByOrderId(id);
        for (const item of items) {
          if (item.productName && item.productName.trim()) {
            await storage.createRecurringOrderItem({
              recurringOrderId: id,
              productName: item.productName,
              quantity: item.quantity || 1,
            });
          }
        }
      }

      // Sync changes to this week's already-stamped manual order (if one exists)
      const hasFieldChanges = Object.keys(orderUpdate).length > 0;
      const hasItemChanges = items && Array.isArray(items);
      if (hasFieldChanges || hasItemChanges) {
        const effectiveName = (orderUpdate.customerName || existing.customerName) as string;
        const effectiveIsTuesday = updates.isTuesday !== undefined ? !!updates.isTuesday : !!existing.isTuesday;

        // Current week: most recent Saturday → following Wednesday
        const ukNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/London" }));
        const dow = ukNow.getDay();
        const daysBack = dow === 6 ? 0 : dow === 0 ? 1 : dow + 1;
        const weekStart = new Date(ukNow);
        weekStart.setDate(weekStart.getDate() - daysBack);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 4);
        weekEnd.setHours(23, 59, 59, 999);

        const weekOrders = await storage.getOrders(weekStart, weekEnd);
        const matchingOrders = weekOrders.filter(o =>
          o.isManual &&
          o.customerName.toLowerCase().trim() === effectiveName.toLowerCase().trim() &&
          (effectiveIsTuesday ? !!o.isTuesday : !o.isTuesday)
        );

        for (const order of matchingOrders) {
          // Sync order-level fields that changed
          const orderFieldSync: any = {};
          if (orderUpdate.customerName !== undefined) orderFieldSync.customerName = orderUpdate.customerName;
          if (orderUpdate.deliveryAddress !== undefined) orderFieldSync.deliveryAddress = orderUpdate.deliveryAddress;
          if (orderUpdate.fulfillmentType !== undefined) orderFieldSync.fulfillmentType = orderUpdate.fulfillmentType;
          if (orderUpdate.notes !== undefined) orderFieldSync.notes = orderUpdate.notes;
          if (Object.keys(orderFieldSync).length > 0) {
            await storage.updateOrder(order.id, orderFieldSync);
          }

          // Sync items if they changed
          if (hasItemChanges) {
            await storage.deleteOrderItemsByOrderId(order.id);
            for (const item of items!) {
              if (item.productName && item.productName.trim()) {
                await storage.createOrderItem({
                  orderId: order.id,
                  productId: null,
                  productName: item.productName,
                  quantity: item.quantity || 1,
                  price: "0",
                });
              }
            }
          }
        }
      }

      const orderItems = await storage.getRecurringOrderItems(id);
      res.json({ ...updated, items: orderItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Delete all manual (stamped) orders for the current week.
  // MUST be registered before the generic /:id route so Express doesn't swallow it.
  app.delete("/api/recurring-orders/stamps-this-week", async (req, res) => {
    try {
      const week = getWeekRange(0);
      const thisWeekOrders = await storage.getOrders(week.from, week.to);
      const manualOrders = thisWeekOrders.filter(o => o.isManual);
      for (const o of manualOrders) {
        await storage.deleteOrderItemsByOrderId(o.id);
        await storage.deleteOrder(o.id);
      }
      res.json({ deleted: manualOrders.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/recurring-orders/:id", async (req, res) => {
    try {
      await storage.deleteRecurringOrder(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/recurring-orders/:id/stamp", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const ro = await storage.getRecurringOrder(id);
      if (!ro) return res.status(404).json({ message: "Not found" });
      const templateItems = await storage.getRecurringOrderItems(id);
      const itemsToUse = (req.body.items && Array.isArray(req.body.items))
        ? req.body.items
        : templateItems;
      const order = await storage.createOrder({
        customerName: ro.customerName,
        deliveryAddress: ro.deliveryAddress || null,
        fulfillmentType: ro.fulfillmentType,
        orderDate: new Date(),
        status: "processing",
        isManual: true,
        isTuesday: ro.isTuesday,
        notes: ro.notes || null,
      });
      for (const item of itemsToUse) {
        if (!item.productName?.trim()) continue;
        await storage.createOrderItem({
          orderId: order.id,
          productId: null,
          productName: item.productName,
          quantity: item.quantity || 1,
          price: "0",
        });
      }
      const orderItems = await storage.getOrderItems(order.id);
      res.json({ ...order, items: orderItems });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/recurring-orders/deduplicate", async (req, res) => {
    try {
      const all = await storage.getRecurringOrders();
      const groups = new Map<string, typeof all>();
      for (const ro of all) {
        const key = `${ro.customerName.toLowerCase().trim()}|${ro.isTuesday}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(ro);
      }
      let removed = 0;
      for (const [, group] of groups) {
        if (group.length <= 1) continue;
        // Score each entry: prefer having an address + items
        const scored = await Promise.all(group.map(async ro => {
          const items = await storage.getRecurringOrderItems(ro.id);
          const score = (ro.deliveryAddress ? 2 : 0) + (items.length > 0 ? 1 : 0);
          return { ro, score };
        }));
        scored.sort((a, b) => b.score - a.score || a.ro.id - b.ro.id);
        // Keep the best one, delete the rest
        for (const { ro } of scored.slice(1)) {
          await storage.deleteRecurringOrder(ro.id);
          removed++;
        }
      }
      res.json({ removed });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/recurring-orders/generate", async (req, res) => {
    try {
      const recurringOrdersList = await storage.getRecurringOrders();
      const active = recurringOrdersList.filter(ro => ro.active && ro.isTuesday !== false);
      if (active.length === 0) {
        return res.json({ created: 0, message: "No active recurring orders" });
      }

      let created = 0;
      for (const ro of active) {
        const items = await storage.getRecurringOrderItems(ro.id);
        if (items.length === 0) continue;

        const order = await storage.createOrder({
          customerName: ro.customerName,
          deliveryAddress: ro.deliveryAddress || null,
          fulfillmentType: ro.fulfillmentType,
          orderDate: new Date(),
          status: "processing",
          isManual: true,
          isTuesday: ro.isTuesday,
        });

        for (const item of items) {
          await storage.createOrderItem({
            orderId: order.id,
            productId: null,
            productName: item.productName,
            quantity: item.quantity,
            price: "0",
          });
        }
        created++;
      }

      res.json({ created, total: active.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/recurring-orders/generate-saturday", async (req, res) => {
    try {
      const recurringOrdersList = await storage.getRecurringOrders();
      const active = recurringOrdersList.filter(ro => ro.active && ro.isTuesday === false);
      if (active.length === 0) {
        return res.json({ created: 0, message: "No active Saturday recurring orders" });
      }

      let created = 0;
      for (const ro of active) {
        const items = await storage.getRecurringOrderItems(ro.id);
        if (items.length === 0) continue;

        const order = await storage.createOrder({
          customerName: ro.customerName,
          deliveryAddress: ro.deliveryAddress || null,
          fulfillmentType: ro.fulfillmentType,
          orderDate: new Date(),
          status: "processing",
          isManual: true,
          isTuesday: false,
        });

        for (const item of items) {
          await storage.createOrderItem({
            orderId: order.id,
            productId: null,
            productName: item.productName,
            quantity: item.quantity,
            price: "0",
          });
        }
        created++;
      }

      res.json({ created, total: active.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });


  // Smart stamp: create this week's orders for all active recurring customers,
  // using last week's actual orders as the item template and mapping to the current week's menu.
  app.post("/api/recurring-orders/smart-stamp-all", async (req, res) => {
    try {
      const week = getWeekRange(0);
      const prevWeek = getWeekRange(-1);
      // Meal price floor: anything at or above this price is a "meal" (included in subscription).
      // Using a floor rather than an exact price makes the stamp robust across price changes
      // (e.g. £7.50 → £7.75) without needing a code deploy each time.
      const MEAL_PRICE_FLOOR = 6.00;

      // Resolve current week's menu
      const { categoryName } = await getCurrentWeekInfo();
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);
      const menuProducts = weekProducts.length > 0 ? weekProducts : allProducts;
      const menuMeals = menuProducts.filter(p => {
        const pr = parseFloat(p.price || "0");
        return pr >= MEAL_PRICE_FLOOR;
      });
      const menuExtras = menuProducts.filter(p => {
        const pr = parseFloat(p.price || "0");
        return pr > 0 && pr < MEAL_PRICE_FLOOR;
      });

      // Active recurring customers
      const recurringOrdersList = await storage.getRecurringOrders();
      const active = recurringOrdersList.filter(ro => ro.active);
      if (active.length === 0) return res.json({ created: 0, skipped: 0, total: 0, details: [] });

      // This week's manual orders (for dedup check)
      const thisWeekOrders = await storage.getOrders(week.from, week.to);

      // Search back up to 3 weeks to find the most recent order per customer.
      // This handles: isTuesday null vs false boundary issues, week-boundary edge cases,
      // and customers who may have missed a week.
      const threeWeeksAgo = getWeekRange(-3);
      const recentOrders = await storage.getOrders(threeWeeksAgo.from, prevWeek.to);
      const recentWithItems = await Promise.all(
        recentOrders.map(async o => ({ ...o, items: await storage.getOrderItems(o.id) }))
      );
      // Sort newest-first so .find() picks the most recent match
      recentWithItems.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

      // Detect the primary protein / ingredient category of a meal by its name.
      // Returns a stable category key used for matching across weeks.
      function detectProtein(name: string): string | null {
        const CATEGORIES: Array<{ key: string; re: RegExp }> = [
          { key: "oats",    re: /oat|porridge|overnight/i },
          { key: "chicken", re: /chicken/i },
          { key: "beef",    re: /beef|steak|bolognese|mince/i },
          { key: "lamb",    re: /lamb|kofta/i },
          { key: "pork",    re: /pork|ham\b/i },
          { key: "turkey",  re: /turkey/i },
          { key: "salmon",  re: /salmon/i },
          { key: "fish",    re: /fish|tuna|cod|haddock|prawn|shrimp|seafood/i },
          { key: "veg",     re: /vegetarian|vegan|tofu|lentil|bean|chickpea|falafel|halloumi|quorn/i },
        ];
        for (const { key, re } of CATEGORIES) {
          if (re.test(name)) return key;
        }
        return null;
      }

      // Helper: build items from a source item list mapped to the current week's menu.
      // Strategy (in priority order):
      //  1. Exact name match — same product exists this week → keep it.
      //  2. Protein/category match — find a this-week meal in the same protein category.
      //  3. Any remaining quantity — fill from unused current-week meals (predictable order, not random).
      function resolveItems(
        sourceItems: Array<{ productName: string; quantity: number; price?: string | null }>,
        allMeals: typeof menuMeals,
        allExtras: typeof menuExtras,
      ) {
        const SKIP = /add\s+delivery|subscription/i;
        const src = sourceItems.filter(i => !SKIP.test(i.productName));

        // Resolve the effective price for a source item.
        // Stamped orders often store price=0; fall back to the known product catalogue price.
        function effectivePrice(item: { productName: string; price?: string | null }): number {
          const linePrice = parseFloat(item.price || "0");
          if (linePrice > 0) return linePrice;
          // Look up real price from the full product list (matched by name, case-insensitive)
          const catalogProduct = allProducts.find(p => p.name.toLowerCase() === item.productName.toLowerCase());
          return catalogProduct ? parseFloat(catalogProduct.price || "0") : 0;
        }

        // Separate meals vs extras using the effective (catalogue-resolved) price.
        // Price floor approach: anything >= MEAL_PRICE_FLOOR is a meal, otherwise an extra.
        // Unknown price (0) defaults to meal — safer than dropping items.
        const mealSrc = src.filter(i => {
          const pr = effectivePrice(i);
          return pr <= 0 || pr >= MEAL_PRICE_FLOOR;
        });
        const extraSrc = src.filter(i => {
          const pr = effectivePrice(i);
          return pr > 0 && pr < MEAL_PRICE_FLOOR;
        });

        const totalMealQty = mealSrc.reduce((s, i) => s + i.quantity, 0);
        const resolved: Array<{ productName: string; quantity: number; price: string; productId: number | null }> = [];

        // --- Meals ---
        if (totalMealQty > 0) {
          type MenuMeal = (typeof menuMeals)[0];
          const usedMeals = new Map<string, { product: MenuMeal; qty: number }>();

          function assign(product: MenuMeal, qty: number) {
            const ex = usedMeals.get(product.name);
            if (ex) ex.qty += qty; else usedMeals.set(product.name, { product, qty });
          }

          let remaining = totalMealQty;

          // Pass 1: exact name match
          for (const item of mealSrc) {
            const match = allMeals.find(m => m.name.toLowerCase() === item.productName.toLowerCase());
            if (match) { assign(match, item.quantity); remaining -= item.quantity; }
          }

          if (remaining > 0) {
            // Build protein demand from items NOT yet matched by name
            const unmatched = mealSrc.filter(
              item => !allMeals.some(m => m.name.toLowerCase() === item.productName.toLowerCase())
            );

            // Group current-week meals by protein category (unused meals first)
            const unusedMeals = allMeals.filter(m => !usedMeals.has(m.name));
            const mealsByProtein = new Map<string, MenuMeal[]>();
            for (const m of unusedMeals) {
              const cat = detectProtein(m.name) ?? "__other__";
              const arr = mealsByProtein.get(cat) ?? [];
              arr.push(m);
              mealsByProtein.set(cat, arr);
            }

            // Pass 2: match by protein category using unmatched source items
            for (const item of unmatched) {
              const cat = detectProtein(item.productName);
              const candidates = cat ? (mealsByProtein.get(cat) ?? []) : [];
              if (candidates.length > 0) {
                // Take from the front of the candidates list (stable, alphabetical)
                const pick = candidates.shift()!;
                assign(pick, item.quantity);
                remaining -= item.quantity;
                // Remove this category list if now empty
                if (candidates.length === 0) mealsByProtein.delete(cat!);
              }
            }

            // Pass 3: fill any remaining quantity from unused meals (stable order)
            if (remaining > 0) {
              const pool = allMeals.filter(m => !usedMeals.has(m.name));
              const fallback = pool.length > 0 ? pool : allMeals;
              for (let i = 0; remaining > 0; i++, remaining--) {
                assign(fallback[i % fallback.length], 1);
              }
            }
          }

          for (const { product, qty } of usedMeals.values()) {
            resolved.push({ productName: product.name, quantity: qty, price: product.price || "7.75", productId: product.id });
          }
        }

        // --- Extras / add-ons (oats, soups, etc.) ---
        // Rotation counters per protein category so multiple extras of the same type
        // (e.g. two different oat flavours from last week) each get a different this-week variant.
        const catRotation = new Map<string, number>();

        for (const ex of extraSrc) {
          const srcPrice = ex.price || "0";
          // 1. Exact name match
          const exact = allExtras.find(m => m.name.toLowerCase() === ex.productName.toLowerCase());
          if (exact) {
            resolved.push({ productName: exact.name, quantity: ex.quantity, price: exact.price || srcPrice, productId: exact.id });
            continue;
          }
          // 2. Protein/category match with rotation — e.g. last-week oats → spread across this-week oat variants
          const srcCat = detectProtein(ex.productName);
          if (srcCat) {
            const catPool = allExtras.filter(m => detectProtein(m.name) === srcCat);
            if (catPool.length > 0) {
              const idx = catRotation.get(srcCat) ?? 0;
              catRotation.set(srcCat, idx + 1);
              const catMatch = catPool[idx % catPool.length];
              resolved.push({ productName: catMatch.name, quantity: ex.quantity, price: catMatch.price || srcPrice, productId: catMatch.id });
              continue;
            }
          }
          // 3. Same price tier
          const srcEffectivePrice = effectivePrice(ex);
          const samePrice = allExtras.find(m => Math.abs(parseFloat(m.price || "0") - srcEffectivePrice) < 0.01);
          if (samePrice) {
            resolved.push({ productName: samePrice.name, quantity: ex.quantity, price: samePrice.price || srcPrice, productId: samePrice.id });
            continue;
          }
          // 4. Keep original (not in current menu — keep as-is so admin can review)
          resolved.push({ productName: ex.productName, quantity: ex.quantity, price: srcPrice, productId: null });
        }

        return resolved;
      }

      let created = 0;
      let skipped = 0;
      const details: string[] = [];

      for (const ro of active) {
        // Dedup: skip if a manual order for this customer+day already exists this week
        const alreadyExists = thisWeekOrders.some(
          o => o.customerName.toLowerCase().trim() === ro.customerName.toLowerCase().trim()
            && !!o.isTuesday === !!ro.isTuesday && o.isManual
        );
        if (alreadyExists) {
          skipped++;
          details.push(`${ro.customerName} (${ro.isTuesday ? "Tue" : "Sat"}): already stamped this week — skipped`);
          continue;
        }

        // Find most recent order for this customer + day (up to 3 weeks back), newest-first.
        // If no same-day order exists, fall back to any recent order from that customer
        // (e.g. Sat order used as basis for Tue stamp) rather than the stale template.
        const customerKey = ro.customerName.toLowerCase().trim();
        const lastOrder =
          recentWithItems.find(
            o => o.customerName.toLowerCase().trim() === customerKey
              && !!o.isTuesday === !!ro.isTuesday
          ) ??
          recentWithItems.find(
            o => o.customerName.toLowerCase().trim() === customerKey
          );

        let newItems: ReturnType<typeof resolveItems>;

        if (lastOrder && lastOrder.items.length > 0) {
          newItems = resolveItems(
            lastOrder.items.map(i => ({ productName: i.productName, quantity: i.quantity, price: i.price })),
            menuMeals,
            menuExtras,
          );
          const daysAgo = Math.round((Date.now() - new Date(lastOrder.orderDate).getTime()) / 86400000);
          details.push(`${ro.customerName} (${ro.isTuesday ? "Tue" : "Sat"}): based on order from ${daysAgo}d ago (${new Date(lastOrder.orderDate).toLocaleDateString("en-GB")})`);
        } else {
          // Fall back to stored template — treat all template items as £7.75 meals
          const templateItems = await storage.getRecurringOrderItems(ro.id);
          if (templateItems.length === 0) {
            skipped++;
            details.push(`${ro.customerName} (${ro.isTuesday ? "Tue" : "Sat"}): no template or last week's order — skipped`);
            continue;
          }
          newItems = resolveItems(
            templateItems.map(i => ({ productName: i.productName, quantity: i.quantity, price: "7.75" })),
            menuMeals,
            menuExtras,
          );
          details.push(`${ro.customerName} (${ro.isTuesday ? "Tue" : "Sat"}): based on stored template (no last week order found)`);
        }

        if (newItems.length === 0) {
          skipped++;
          details.push(`${ro.customerName} (${ro.isTuesday ? "Tue" : "Sat"}): no items resolved — skipped`);
          continue;
        }

        const order = await storage.createOrder({
          customerName: ro.customerName,
          deliveryAddress: ro.deliveryAddress || null,
          fulfillmentType: ro.fulfillmentType,
          orderDate: new Date(),
          status: "processing",
          isManual: true,
          isTuesday: ro.isTuesday,
          notes: ro.notes || null,
        });

        for (const item of newItems) {
          await storage.createOrderItem({
            orderId: order.id,
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            price: item.price,
          });
        }

        created++;
      }

      res.json({ created, skipped, total: active.length, details });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/weekly-stats", async (req, res) => {
    try {
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;
      if (!from || !to) {
        return res.status(400).json({ message: "from and to query parameters are required" });
      }

      const ordersList = await storage.getOrders(from, to);
      const ordersWithItems = await Promise.all(
        ordersList.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);

      const priorOrders = await storage.getOrders(undefined, new Date(from.getTime() - 1));

      let mealsSold = 0;
      let revenue = 0;
      const mealCounts: Record<string, number> = {};

      const subscriptionPattern = /meal\s+subscription\s*-\s*(\d+)/i;

      for (const order of ordersWithItems) {
        revenue += parseFloat((order as any).shippingTotal || "0");
        for (const item of order.items) {
          if (subscriptionPattern.test(item.productName)) continue;
          const lineValue = order.isManual
            ? parseFloat(item.price || "0") * item.quantity
            : parseFloat(item.price || "0");
          revenue += lineValue;
          if (!item.productName.toLowerCase().includes("add delivery")) {
            mealsSold += item.quantity;
            mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
          }
        }
      }

      const orderCount = ordersWithItems.length;
      const avgOrderValue = orderCount > 0 ? revenue / orderCount : 0;

      const deliveryStops = ordersWithItems.filter(o => o.fulfillmentType === "delivery").length;

      const priorEmails = new Set<string>();
      const priorNames = new Set<string>();
      for (const o of priorOrders) {
        if (o.customerEmail) priorEmails.add(o.customerEmail.toLowerCase());
        priorNames.add(o.customerName.toLowerCase());
      }

      let newCustomers = 0;
      let returningCustomers = 0;
      const counted = new Set<string>();
      for (const o of ordersWithItems) {
        const key = o.customerEmail ? o.customerEmail.toLowerCase() : o.customerName.toLowerCase();
        if (counted.has(key)) continue;
        counted.add(key);
        const isPrior = o.customerEmail
          ? priorEmails.has(o.customerEmail.toLowerCase())
          : priorNames.has(o.customerName.toLowerCase());
        if (isPrior) {
          returningCustomers++;
        } else {
          newCustomers++;
        }
      }

      let topSeller = "-";
      let worstSeller = "-";
      const mealEntries = Object.entries(mealCounts);
      if (mealEntries.length > 0) {
        mealEntries.sort((a, b) => b[1] - a[1]);
        topSeller = `${mealEntries[0][0]} (${mealEntries[0][1]})`;
        worstSeller = `${mealEntries[mealEntries.length - 1][0]} (${mealEntries[mealEntries.length - 1][1]})`;
      }

      res.json({
        mealsSold,
        revenue,
        avgOrderValue,
        deliveryStops,
        newCustomers,
        returningCustomers,
        topSeller,
        worstSeller,
        orderCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Stripe: create payment intent for addon charges ───────────────────────
  app.post("/api/subscribe/:token/create-payment-intent", async (req, res) => {
    try {
      const invite = await storage.getSubscriptionInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invitation not found" });

      const { amountPence, description, items } = req.body;
      if (!amountPence || amountPence < 50) {
        return res.status(400).json({ message: "Amount must be at least 50p" });
      }

      const stripe = await getUncachableStripeClient(await getActiveStripeSecretKey());
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountPence,
        currency: "gbp",
        description: description || `Add-on/extra meals for ${invite.customerName}`,
        metadata: {
          inviteId: String(invite.id),
          customerName: invite.customerName,
          customerEmail: invite.customerEmail,
          items: JSON.stringify(items || []),
        },
        receipt_email: invite.customerEmail || undefined,
      });

      await storage.updateSubscriptionInvitePayment(invite.id, {
        stripePaymentIntentId: paymentIntent.id,
        addonAmountPence: amountPence,
        addonPaid: false,
      });

      res.json({ clientSecret: paymentIntent.client_secret });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Stripe: confirm payment completed (called after redirect) ──────────────
  app.post("/api/subscribe/:token/confirm-payment", async (req, res) => {
    try {
      const invite = await storage.getSubscriptionInviteByToken(req.params.token);
      if (!invite) return res.status(404).json({ message: "Invitation not found" });

      const { paymentIntentId } = req.body;
      if (!paymentIntentId) return res.status(400).json({ message: "paymentIntentId required" });

      const stripe = await getUncachableStripeClient(await getActiveStripeSecretKey());
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (pi.status === "succeeded") {
        await storage.updateSubscriptionInvitePayment(invite.id, { addonPaid: true });
        res.json({ success: true, status: "succeeded" });
      } else {
        res.json({ success: false, status: pi.status });
      }
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Stripe: admin create checkout session and send payment link via email ──
  app.post("/api/subscription-invites/:id/send-payment-link", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const invite = await storage.getSubscriptionInviteById(id);
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const { overrideEmail } = req.body;
      let { amountPence, items } = req.body as { amountPence?: number; items?: any[] };

      if (!amountPence || amountPence < 50) {
        const allProducts = await storage.getProducts();
        const productPriceByName = new Map<string, number>();
        for (const p of allProducts) {
          productPriceByName.set(p.name.toLowerCase(), parseFloat(p.price || "0"));
        }
        const STANDARD_PRICE = 7.75;
        const selections = await storage.getSubscriptionSelections(invite.id);
        const extraItems: Array<{ name: string; pricePence: number; quantity: number }> = [];
        for (const sel of selections) {
          const price = productPriceByName.get(sel.productName.toLowerCase());
          if (price !== undefined && price !== STANDARD_PRICE) {
            extraItems.push({ name: sel.productName, pricePence: Math.round(price * 100), quantity: sel.quantity });
          }
        }
        amountPence = extraItems.reduce((sum, i) => sum + i.pricePence * i.quantity, 0);
        items = extraItems;
        if (!amountPence || amountPence < 50) {
          return res.status(400).json({ message: "No chargeable add-ons found for this invite" });
        }
      }

      const stripeKey = await getActiveStripeSecretKey();
      if (!stripeKey) {
        return res.status(400).json({ message: "No Stripe API key configured. Add your Stripe keys in Settings → Stripe Payments." });
      }

      const baseUrl = await getPortalBaseUrl();
      const stripe = await getUncachableStripeClient(stripeKey);

      const lineItems = Array.isArray(items) && items.length > 0
        ? items.map((item: any) => ({
            price_data: {
              currency: "gbp",
              unit_amount: Math.round(item.pricePence),
              product_data: { name: item.name },
            },
            quantity: item.quantity,
          }))
        : [{
            price_data: {
              currency: "gbp",
              unit_amount: amountPence,
              product_data: { name: `Add-ons / Extra meals – ${invite.customerName}` },
            },
            quantity: 1,
          }];

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: lineItems,
        mode: "payment",
        customer_email: invite.customerEmail || undefined,
        success_url: `${baseUrl}/subscribe/${invite.token}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/subscribe/${invite.token}`,
        metadata: {
          inviteId: String(invite.id),
          customerName: invite.customerName,
        },
      });

      await storage.updateSubscriptionInvitePayment(invite.id, {
        addonAmountPence: amountPence,
        addonPaid: false,
        addonPaymentToken: session.id,
      });

      const toEmail = overrideEmail?.trim() || invite.customerEmail;
      if (toEmail) {
        const transporter = await getSmtpTransporter();
        const fromEmail = await getSmtpFromEmail();
        if (transporter && fromEmail) {
          const firstName = invite.customerName.split(" ")[0];
          const amountFormatted = `£${(amountPence / 100).toFixed(2)}`;
          const itemsList = Array.isArray(items) && items.length > 0
            ? items.map((i: any) => `<li>${i.name} ×${i.quantity} — £${(i.pricePence / 100 * i.quantity).toFixed(2)}</li>`).join("")
            : "";
          await transporter.sendMail({
            from: fromEmail,
            to: toEmail,
            subject: `Payment required for your add-ons – Simple Kitchen Prep`,
            html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #059669;">Hi ${firstName},</h2>
              <p>You have selected some extra meals or add-ons that require payment of <strong>${amountFormatted}</strong>.</p>
              ${itemsList ? `<ul style="margin: 16px 0;">${itemsList}</ul>` : ""}
              <p>Please click the button below to complete your payment securely via Stripe:</p>
              <a href="${session.url}" style="display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;margin:12px 0;">Pay ${amountFormatted} Now</a>
              <p style="color:#6b7280;font-size:13px;margin-top:24px;">If you have any questions, please reply to this email.</p>
            </div>`,
          });
        }
      }

      res.json({ success: true, checkoutUrl: session.url, to: toEmail });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Stripe: verify checkout session paid (used by success redirect page) ──
  app.get("/api/stripe/session-status", async (req, res) => {
    try {
      const sessionId = req.query.session_id as string;
      if (!sessionId) return res.status(400).json({ message: "session_id required" });
      const stripe = await getUncachableStripeClient(await getActiveStripeSecretKey());
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["line_items"],
      });

      if (session.payment_status === "paid") {
        const inviteId = session.metadata?.inviteId ? parseInt(session.metadata.inviteId) : null;
        if (inviteId) {
          const invite = await storage.getSubscriptionInviteById(inviteId);
          const alreadyPaid = invite?.addonPaid === true;

          await storage.updateSubscriptionInvitePayment(inviteId, { addonPaid: true });

          // Send receipt email once, on first confirmation
          if (!alreadyPaid && invite) {
            try {
              const transporter = await getSmtpTransporter();
              const fromEmail = await getSmtpFromEmail();

              if (transporter && fromEmail && invite.customerEmail) {
                const firstName = invite.customerName.split(" ")[0];
                const amountTotal = session.amount_total ?? 0;
                const amountFormatted = `£${(amountTotal / 100).toFixed(2)}`;
                const lineItems = (session.line_items?.data ?? []) as Array<{ description?: string | null; quantity?: number | null; amount_total?: number | null }>;

                const itemRows = lineItems.length > 0
                  ? lineItems.map(li => {
                      const desc = li.description ?? "Add-on";
                      const qty = li.quantity ?? 1;
                      const lineTotal = `£${((li.amount_total ?? 0) / 100).toFixed(2)}`;
                      return `<tr>
                        <td style="padding:6px 12px;border-bottom:1px solid #eee;">${desc}</td>
                        <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center;">${qty}</td>
                        <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${lineTotal}</td>
                      </tr>`;
                    }).join("")
                  : `<tr><td colspan="3" style="padding:6px 12px;">Add-on extras</td></tr>`;

                const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333;">
  <h2 style="color:#059669;">Payment Receipt – Simple Kitchen Prep</h2>
  <p>Hi ${firstName},</p>
  <p>Thank you for your payment! Here's your receipt for your add-on extras this week.</p>
  <table style="width:100%;border-collapse:collapse;margin:20px 0;">
    <thead>
      <tr style="background:#f3f4f6;">
        <th style="padding:8px 12px;text-align:left;">Item</th>
        <th style="padding:8px 12px;text-align:center;">Qty</th>
        <th style="padding:8px 12px;text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="2" style="padding:8px 12px;font-weight:bold;text-align:right;">Total paid:</td>
        <td style="padding:8px 12px;font-weight:bold;text-align:right;">${amountFormatted}</td>
      </tr>
    </tfoot>
  </table>
  <p style="color:#6b7280;font-size:13px;">Your meals will be ready for collection/delivery as usual this week. If you have any questions, just reply to this email.</p>
  <p style="color:#6b7280;font-size:13px;">— Simple Kitchen Prep</p>
</div>`;

                await transporter.sendMail({
                  from: fromEmail,
                  to: invite.customerEmail,
                  subject: `Payment confirmed – ${amountFormatted} – Simple Kitchen Prep`,
                  html,
                });
                log(`Receipt email sent to ${invite.customerEmail} for invite ${inviteId}`, "stripe");
              }
            } catch (emailErr: any) {
              log(`Receipt email failed for invite ${inviteId}: ${emailErr.message}`, "stripe");
            }
          }
        }
      }

      res.json({
        status: session.payment_status,
        customerEmail: session.customer_email,
        customerName: session.metadata?.customerName,
        amountTotal: session.amount_total,
        lineItems: session.line_items,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── Addon Order Links ──────────────────────────────────────────────────────
  // Admin creates a one-time payment link to append extra items to an existing order.

  app.post("/api/orders/:id/addon-link", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
    try {
      const orderId = parseInt(req.params.id);
      const order = await storage.getOrder(orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      const token = crypto.randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await storage.createAddonLink(token, orderId, expiresAt);
      const baseUrl = await getPortalBaseUrl();
      res.json({ url: `${baseUrl}/addon/${token}` });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/addon/:token", async (req, res) => {
    try {
      const link = await storage.getAddonLink(req.params.token);
      if (!link) return res.status(404).json({ message: "Link not found" });
      if (new Date() > new Date(link.expiresAt)) return res.status(410).json({ message: "Link has expired" });
      if (link.completedAt) return res.status(410).json({ message: "This link has already been used" });
      const order = await storage.getOrder(link.orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });
      // Return only validity info — no order details until email is verified
      res.json({
        valid: true,
        expiresAt: link.expiresAt,
        requiresEmail: !!order.customerEmail,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/addon/:token/verify", async (req, res) => {
    try {
      const link = await storage.getAddonLink(req.params.token);
      if (!link) return res.status(404).json({ message: "Link not found" });
      if (new Date() > new Date(link.expiresAt)) return res.status(410).json({ message: "Link has expired" });
      if (link.completedAt) return res.status(410).json({ message: "This link has already been used" });
      const order = await storage.getOrder(link.orderId);
      if (!order) return res.status(404).json({ message: "Order not found" });

      // Validate email if the order has one on record
      if (order.customerEmail) {
        const submitted = (req.body.email || "").trim().toLowerCase();
        const expected = order.customerEmail.trim().toLowerCase();
        if (submitted !== expected) {
          return res.status(403).json({ message: "Email address doesn't match our records" });
        }
      }

      const items = await storage.getOrderItems(link.orderId);
      const { categoryName } = await getCurrentWeekInfo();
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);
      const SKIP_PAT = /subscription|add delivery|meal sub/i;
      const availableProducts = (weekProducts.length > 0 ? weekProducts : allProducts)
        .filter(p => !SKIP_PAT.test(p.name) && parseFloat(p.price ?? "0") > 0);
      res.json({
        order: {
          id: order.id,
          customerName: order.customerName,
          orderDate: order.orderDate,
          items: items.filter(i => !i.portalAdded),
        },
        products: availableProducts,
        expiresAt: link.expiresAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/addon/:token/checkout", async (req, res) => {
    try {
      const link = await storage.getAddonLink(req.params.token);
      if (!link) return res.status(404).json({ message: "Link not found" });
      if (new Date() > new Date(link.expiresAt)) return res.status(410).json({ message: "Link has expired" });
      if (link.completedAt) return res.status(410).json({ message: "This link has already been used" });

      const { items } = req.body as { items: Array<{ productId: number; quantity: number }> };
      if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ message: "No items selected" });

      const allProducts = await storage.getProducts();
      const lineItems: Array<{ productId: number; productName: string; quantity: number; price: string; pricePence: number }> = [];
      for (const sel of items) {
        const product = allProducts.find(p => p.id === sel.productId);
        if (!product) return res.status(400).json({ message: `Product ${sel.productId} not found` });
        if (sel.quantity < 1) continue;
        const pricePence = Math.round(parseFloat(product.price ?? "0") * 100);
        lineItems.push({ productId: product.id, productName: product.name, quantity: sel.quantity, price: product.price ?? "0", pricePence });
      }
      if (lineItems.length === 0) return res.status(400).json({ message: "No valid items" });

      const order = await storage.getOrder(link.orderId);
      const pendingJson = JSON.stringify(lineItems);
      await storage.updateAddonLink(link.token, { pendingItems: pendingJson });

      const baseUrl = await getPortalBaseUrl();
      const stripe = await getUncachableStripeClient(await getActiveStripeSecretKey());
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: lineItems.map(i => ({
          price_data: { currency: "gbp", unit_amount: i.pricePence, product_data: { name: i.productName } },
          quantity: i.quantity,
        })),
        mode: "payment",
        customer_email: order?.customerEmail ?? undefined,
        success_url: `${baseUrl}/addon/${link.token}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/addon/${link.token}`,
        metadata: { orderId: String(link.orderId), addonToken: link.token },
      });
      await storage.updateAddonLink(link.token, { stripeSessionId: session.id, pendingItems: pendingJson });
      res.json({ checkoutUrl: session.url });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/addon/:token/success", async (req, res) => {
    try {
      const link = await storage.getAddonLink(req.params.token);
      if (!link) return res.status(404).json({ message: "Link not found" });
      if (link.completedAt) return res.json({ alreadyCompleted: true });

      const sessionId = req.query.session_id as string;
      if (!sessionId || link.stripeSessionId !== sessionId) {
        return res.status(400).json({ message: "Invalid session" });
      }

      const stripe = await getUncachableStripeClient(await getActiveStripeSecretKey());
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status !== "paid") return res.status(402).json({ message: "Payment not completed" });

      const pendingItems: Array<{ productId: number; productName: string; quantity: number; price: string }> =
        JSON.parse(link.pendingItems ?? "[]");

      for (const item of pendingItems) {
        const product = await storage.getProduct(item.productId);
        await storage.createOrderItem({
          orderId: link.orderId,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          price: String(parseFloat(item.price) * item.quantity),
          portalAdded: true,
        });
      }

      await storage.updateAddonLink(link.token, { completedAt: new Date() });
      res.json({ success: true, orderId: link.orderId });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  startAutoSync();

  return httpServer;
}
