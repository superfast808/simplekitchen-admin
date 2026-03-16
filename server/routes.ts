import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fetchWooOrders, fetchWooProducts, decodeHtmlEntities } from "./woocommerce";
import { insertProductSchema, insertIngredientSchema, insertOrderSchema, insertOrderItemSchema, insertManualQuantitySchema } from "@shared/schema";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import multer from "multer";
import bcrypt from "bcrypt";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { log } from "./index";

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
async function getCurrentWeekInfo(): Promise<{ weekNumber: number; categoryName: string }> {
  const refDateStr = await storage.getSetting("week1ReferenceDate");
  if (!refDateStr) return { weekNumber: 1, categoryName: "Week 1" };
  const refDate = new Date(refDateStr);
  const now = new Date();
  const diffMs = now.getTime() - refDate.getTime();
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

// Auto-send window: Saturday through Wednesday 19:00 UK time
function isWithinAutoSendWindow(): boolean {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const day = ukNow.getDay(); // 0=Sun … 6=Sat
  if (day === 6 || day === 0 || day === 1 || day === 2) return true; // Sat–Tue always ok
  if (day === 3) return ukNow.getHours() < 19; // Wed before 7 pm ok
  return false; // Thu/Fri — closed, admin does it manually
}

// Attempt to auto-send subscription invite emails for any subscription order
// in the current week that hasn't already been invited.
async function autoSendSubscriptionInvites(): Promise<void> {
  if (!isWithinAutoSendWindow()) return;

  try {
    const transporter = await getSmtpTransporter();
    if (!transporter) return;

    const baseUrl = await getPortalBaseUrl();
    const fromEmail = await getSmtpFromEmail();

    const subscriptionPattern = /meal\s+subscription\s*-\s*(\d+)/i;
    const week = getWeekRange(0);
    const ordersList = await storage.getOrders(week.from, week.to);
    const ordersWithItems = await Promise.all(
      ordersList.map(async (order) => ({ ...order, items: await storage.getOrderItems(order.id) }))
    );

    const subOrders = ordersWithItems.filter(o =>
      o.items.some(i => subscriptionPattern.test(i.productName))
    );
    if (subOrders.length === 0) return;

    const existingInvites = await storage.getSubscriptionInvites(week.from, week.to);
    const alreadyInvitedOrderIds = new Set(existingInvites.map(i => i.orderId));

    const settingsMap = await getSettingsMap();
    const emailSubject = settingsMap.subscription_email_subject || DEFAULT_EMAIL_SUBJECT;
    const emailBodyTemplate = settingsMap.subscription_email_body || DEFAULT_EMAIL_BODY;

    for (const order of subOrders) {
      if (alreadyInvitedOrderIds.has(order.id)) continue;

      const subItem = order.items.find(i => subscriptionPattern.test(i.productName));
      if (!subItem) continue;
      const match = subItem.productName.match(subscriptionPattern);
      const qty = match ? parseInt(match[1], 10) : 0;
      if (qty === 0) continue;

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
        subscriptionQuantity: qty,
        status: "pending",
        weekFrom: week.from,
        weekTo: week.to,
        deliveryAddress: inviteAddress,
        fulfillmentType: inviteFulfillment,
      });

      const toEmail = order.customerEmail;
      if (!toEmail) continue;

      const selectUrl = `${baseUrl}/subscribe/${token}`;
      const firstName = order.customerName.split(" ")[0];
      const emailBody = emailBodyTemplate
        .replace(/\{\{firstName\}\}/g, firstName)
        .replace(/\{\{fullName\}\}/g, order.customerName)
        .replace(/\{\{qty\}\}/g, String(qty))
        .replace(/\{\{url\}\}/g, selectUrl);
      const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${emailBody}</div>`;

      try {
        await transporter.sendMail({
          from: fromEmail,
          to: toEmail,
          subject: emailSubject
            .replace(/\{\{firstName\}\}/g, firstName)
            .replace(/\{\{fullName\}\}/g, order.customerName)
            .replace(/\{\{qty\}\}/g, String(qty)),
          html: emailHtml,
        });
        log(`Auto-sent subscription invite to ${order.customerName} (${toEmail})`, "sync");
      } catch (emailErr: any) {
        log(`Auto-send subscription email failed for ${order.customerName}: ${emailErr.message}`, "sync");
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
      status: "processing,completed,on-hold",
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
      const meals = weekProducts.filter(p => Math.abs(parseFloat(p.price || "0") - 7.50) < 0.01).sort((a, b) => a.name.localeCompare(b.name));
      const extras = weekProducts.filter(p => { const pr = parseFloat(p.price || "0"); return pr > 0 && Math.abs(pr - 7.50) >= 0.01; }).sort((a, b) => a.name.localeCompare(b.name));
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
      const ingredientsList = req.body.ingredients as Array<{ name: string; quantityPerUnit: string; unit: string }>;
      await storage.deleteIngredientsByProductId(productId);
      const created = [];
      for (const ing of ingredientsList) {
        const result = await storage.createIngredient({
          productId,
          name: ing.name,
          quantityPerUnit: ing.quantityPerUnit,
          unit: ing.unit,
        });
        created.push(result);
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
      res.json(ordersWithItems);
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

      const totals: Record<string, { productName: string; productId: number | null; totalOrdered: number; manualQuantity: number }> = {};
      for (const item of items) {
        const key = item.productName;
        if (!totals[key]) {
          totals[key] = { productName: key, productId: item.productId, totalOrdered: 0, manualQuantity: 0 };
        }
        totals[key].totalOrdered += item.quantity;
      }
      for (const mq of manualQtys) {
        const product = await storage.getProduct(mq.productId);
        if (product) {
          const key = product.name;
          if (!totals[key]) {
            totals[key] = { productName: key, productId: product.id, totalOrdered: 0, manualQuantity: 0 };
          }
          totals[key].manualQuantity += mq.quantity;
        }
      }

      res.json(Object.values(totals));
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

      // Build name→id lookup for items where productId is null
      const productByName: Record<string, number> = {};
      for (const p of allProducts) {
        productByName[p.name.toLowerCase()] = p.id;
      }

      const productQuantities: Record<number, number> = {};
      for (const item of items) {
        const pid = item.productId ?? productByName[item.productName?.toLowerCase()] ?? null;
        if (pid) {
          productQuantities[pid] = (productQuantities[pid] || 0) + item.quantity;
        }
      }
      for (const mq of manualQtys) {
        productQuantities[mq.productId] = (productQuantities[mq.productId] || 0) + mq.quantity;
      }

      const summary: Record<string, { name: string; totalQuantity: number; unit: string }> = {};
      for (const ingredient of allIngredients) {
        const productQty = productQuantities[ingredient.productId] || 0;
        if (productQty > 0) {
          const key = `${ingredient.name}_${ingredient.unit}`;
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

      // Build name→id lookup for items where productId is null
      const productByName: Record<string, number> = {};
      for (const p of allProducts) {
        productByName[p.name.toLowerCase()] = p.id;
      }

      const productQuantities: Record<number, number> = {};
      for (const item of items) {
        const pid = item.productId ?? productByName[item.productName?.toLowerCase()] ?? null;
        if (pid) {
          productQuantities[pid] = (productQuantities[pid] || 0) + item.quantity;
        }
      }
      for (const mq of manualQtys) {
        productQuantities[mq.productId] = (productQuantities[mq.productId] || 0) + mq.quantity;
      }

      const ingredientsByProduct: Record<number, typeof allIngredients> = {};
      for (const ing of allIngredients) {
        if (!ingredientsByProduct[ing.productId]) {
          ingredientsByProduct[ing.productId] = [];
        }
        ingredientsByProduct[ing.productId].push(ing);
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
        }>;
      }> = [];

      const grandTotals: Record<string, { name: string; totalQuantity: number; unit: string }> = {};

      for (const product of allProducts) {
        const pIngredients = ingredientsByProduct[product.id];
        if (!pIngredients || pIngredients.length === 0) continue;
        const orderedQty = productQuantities[product.id] || 0;

        productBreakdowns.push({
          productId: product.id,
          productName: product.name,
          orderedQuantity: orderedQty,
          ingredients: pIngredients.map(ing => {
            const totalNeeded = orderedQty * parseFloat(ing.quantityPerUnit);
            const key = `${ing.name}_${ing.unit}`;
            if (!grandTotals[key]) {
              grandTotals[key] = { name: ing.name, totalQuantity: 0, unit: ing.unit };
            }
            grandTotals[key].totalQuantity += totalNeeded;
            return {
              name: ing.name,
              quantityPerUnit: ing.quantityPerUnit,
              unit: ing.unit,
              totalNeeded,
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
      const allIngredients = await storage.getAllIngredients();
      const uniqueNames = Array.from(new Set(allIngredients.map(i => i.name))).sort();
      const uniqueUnits = Array.from(new Set(allIngredients.map(i => i.unit))).sort();
      res.json({ names: uniqueNames, units: uniqueUnits });
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
        };

        if (existing) {
          if (!existing.deliveryLat || !existing.deliveryLng) {
            orderData.deliveryLat = null;
            orderData.deliveryLng = null;
          }
          await storage.updateOrder(existing.id, orderData);
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
          updated++;
        } else {
          orderData.deliveryLat = null;
          orderData.deliveryLng = null;
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

      res.json({ imported, updated, total: wooOrders.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/woo/sync-products", async (_req, res) => {
    try {
      const wooProducts = await fetchWooProducts({ status: "publish" });
      let imported = 0;
      let updated = 0;

      for (const wp of wooProducts) {
        const existing = await storage.getProductByWooId(wp.id);
        const productData = {
          wooId: wp.id,
          name: decodeHtmlEntities(wp.name),
          price: String(wp.price || "0"),
          imageUrl: wp.images?.[0]?.src || null,
          category: wp.categories?.[0]?.name || null,
        };

        if (existing) {
          await storage.updateProduct(existing.id, productData);
          updated++;
        } else {
          await storage.createProduct(productData);
          imported++;
        }
      }

      res.json({ imported, updated, total: wooProducts.length });
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
      const subRe = /meal\s+subscription\s*-\s*\d+/i;
      const isAddDeliveryOnly = (items: { productName: string }[]) =>
        items.length > 0 && items.every(i => i.productName.toLowerCase().includes("add delivery"));
      // Subscription-origin orders count as "website" for reconciliation
      const subscriptionOrderIds = await storage.getSubscriptionOriginOrderIds();
      const addresses = ordersWithItems
        .filter(o =>
          (o.deliveryAddress || o.fulfillmentType === "collection") &&
          !o.items.some(i => subRe.test(i.productName)) &&
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
      res.json(settingsMap);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const entries = req.body as Record<string, string>;
      for (const [key, value] of Object.entries(entries)) {
        if (!ALLOWED_SETTINGS_KEYS.has(key)) {
          return res.status(400).json({ message: `Unknown setting: ${key}` });
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
      res.json(settingsMap);
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
      // Only print labels for orders that have a delivery address, are not subscription parent orders,
      // and are not standalone "Add Delivery" charge orders
      const labelOrders = ordersWithItems.filter(o =>
        o.deliveryAddress && o.deliveryAddress.trim() &&
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

      const subscriptionPattern = /meal\s+subscription\s*-\s*(\d+)/i;
      const subOrders = ordersWithItems.filter(o =>
        o.items.some(i => subscriptionPattern.test(i.productName))
      );

      if (subOrders.length === 0) {
        return res.json({ sent: 0, message: "No subscription orders found this week" });
      }

      const existingInvites = await storage.getSubscriptionInvites(week.from, week.to);
      const alreadyInvitedOrderIds = new Set(existingInvites.map(i => i.orderId));

      let sent = 0;
      let skipped = 0;
      const errors: string[] = [];
      for (const order of subOrders) {
        if (alreadyInvitedOrderIds.has(order.id)) {
          skipped++;
          continue;
        }

        const subItem = order.items.find(i => subscriptionPattern.test(i.productName));
        if (!subItem) continue;
        const match = subItem.productName.match(subscriptionPattern);
        const qty = match ? parseInt(match[1], 10) : 0;
        if (qty === 0) continue;

        const token = crypto.randomBytes(32).toString("hex");
        let inviteAddress = order.deliveryAddress || null;
        let inviteFulfillment = order.fulfillmentType || "delivery";
        if (!inviteAddress) {
          const pastAddr = await storage.getCustomerDeliveryAddress(
            order.customerEmail || "",
            order.customerName
          );
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
          subscriptionQuantity: qty,
          status: "pending",
          weekFrom: week.from,
          weekTo: week.to,
          deliveryAddress: inviteAddress,
          fulfillmentType: inviteFulfillment,
        });

        const selectUrl = `${baseUrl}/subscribe/${token}`;
        const toEmail = overrideEmail || order.customerEmail;
        if (!toEmail) {
          errors.push(`No email for ${order.customerName}`);
          continue;
        }

        try {
          const settingsMap = await getSettingsMap();
          const emailSubject = settingsMap.subscription_email_subject || DEFAULT_EMAIL_SUBJECT;
          const emailBodyTemplate = settingsMap.subscription_email_body || DEFAULT_EMAIL_BODY;
          const firstName = order.customerName.split(" ")[0];
          const emailBody = emailBodyTemplate
            .replace(/\{\{firstName\}\}/g, firstName)
            .replace(/\{\{fullName\}\}/g, order.customerName)
            .replace(/\{\{qty\}\}/g, String(qty))
            .replace(/\{\{url\}\}/g, selectUrl);
          const emailHtml = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">${emailBody}</div>`;
          await transporter.sendMail({
            from: fromEmail,
            to: toEmail,
            subject: emailSubject
              .replace(/\{\{firstName\}\}/g, firstName)
              .replace(/\{\{fullName\}\}/g, order.customerName)
              .replace(/\{\{qty\}\}/g, String(qty)),
            html: emailHtml,
          });
          sent++;
        } catch (emailErr: any) {
          errors.push(`Failed to email ${order.customerName}: ${emailErr.message}`);
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
      const invites = await storage.getSubscriptionInvites(from, to);
      const result = await Promise.all(
        invites.map(async (invite) => {
          const selections = await storage.getSubscriptionSelections(invite.id);
          return { ...invite, selections };
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

      const { weekNumber, categoryName } = await getCurrentWeekInfo();
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);

      let availableMeals: Array<{ name: string; popularity: number }>;
      let availableExtras: Array<{ name: string; popularity: number }>;

      if (weekProducts.length > 0) {
        availableMeals = weekProducts
          .filter(p => Math.abs(parseFloat(p.price || "0") - 7.50) < 0.01)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(p => ({ name: p.name, popularity: 0 }));
        availableExtras = weekProducts
          .filter(p => { const pr = parseFloat(p.price || "0"); return pr > 0 && Math.abs(pr - 7.50) >= 0.01; })
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(p => ({ name: p.name, popularity: 0 }));
      } else {
        const mealProductNames = new Set(
          allProducts.filter(p => Math.abs(parseFloat(p.price || "0") - 7.50) < 0.01).map(p => p.name)
        );
        const extraProductNames = new Set(
          allProducts.filter(p => {
            const pr = parseFloat(p.price || "0");
            return pr > 0 && Math.abs(pr - 7.50) >= 0.01;
          }).map(p => p.name)
        );
        const ordersList = await storage.getOrders(invite.weekFrom, invite.weekTo);
        const ordersWithItems = await Promise.all(
          ordersList.map(async (order) => {
            const items = await storage.getOrderItems(order.id);
            return { ...order, items };
          })
        );
        const subscriptionPattern = /meal\s+subscription/i;
        const addDeliveryPattern = /add\s+delivery/i;
        const mealCounts: Record<string, number> = {};
        const extraCounts: Record<string, number> = {};
        for (const order of ordersWithItems) {
          for (const item of order.items) {
            if (subscriptionPattern.test(item.productName)) continue;
            if (addDeliveryPattern.test(item.productName)) continue;
            if (extraProductNames.has(item.productName)) {
              extraCounts[item.productName] = (extraCounts[item.productName] || 0) + item.quantity;
            } else {
              mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
            }
          }
        }
        availableMeals = Object.entries(mealCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, popularity: count }));
        availableExtras = Object.entries(extraCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, popularity: count }));
      }

      const existingSelections = await storage.getSubscriptionSelections(invite.id);

      res.json({
        customerName: invite.customerName,
        subscriptionQuantity: invite.subscriptionQuantity,
        status: invite.status,
        weekNumber,
        categoryName,
        availableMeals,
        availableExtras,
        selections: existingSelections,
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

      const { email, selections, extras } = req.body;
      if (!email || typeof email !== "string" || email.toLowerCase() !== invite.customerEmail.toLowerCase()) {
        return res.status(403).json({ message: "Email does not match the subscription order" });
      }

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

      await storage.deleteSubscriptionSelectionsByInviteId(invite.id);
      for (const sel of [...selections, ...extrasList]) {
        await storage.createSubscriptionSelection({
          inviteId: invite.id,
          productName: sel.productName,
          quantity: parseInt(sel.quantity, 10),
        });
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
      });

      for (const sel of selections) {
        await storage.createOrderItem({
          orderId: order.id,
          productId: null,
          productName: sel.productName,
          quantity: parseInt(sel.quantity, 10),
          price: "7.50",
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

      await storage.updateSubscriptionInviteStatus(invite.id, "completed");
      await storage.setSubscriptionInviteSelectionsOrder(invite.id, order.id);

      res.json({ success: true, orderId: order.id });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/subscription-invites/:id/meals", async (req, res) => {
    try {
      const invite = await storage.getSubscriptionInviteById(parseInt(req.params.id));
      if (!invite) return res.status(404).json({ message: "Invite not found" });

      const { weekNumber, categoryName } = await getCurrentWeekInfo();
      const allProducts = await storage.getProducts();
      const weekProducts = allProducts.filter(p => p.category === categoryName);

      let availableMeals: Array<{ name: string; popularity: number }>;
      let availableExtras: Array<{ name: string; popularity: number }>;

      if (weekProducts.length > 0) {
        availableMeals = weekProducts
          .filter(p => Math.abs(parseFloat(p.price || "0") - 7.50) < 0.01)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(p => ({ name: p.name, popularity: 0 }));
        availableExtras = weekProducts
          .filter(p => { const pr = parseFloat(p.price || "0"); return pr > 0 && Math.abs(pr - 7.50) >= 0.01; })
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(p => ({ name: p.name, popularity: 0 }));
      } else {
        const mealProductNames = new Set(
          allProducts.filter(p => Math.abs(parseFloat(p.price || "0") - 7.50) < 0.01).map(p => p.name)
        );
        const extraProductNames = new Set(
          allProducts.filter(p => {
            const pr = parseFloat(p.price || "0");
            return pr > 0 && Math.abs(pr - 7.50) >= 0.01;
          }).map(p => p.name)
        );
        const ordersList = await storage.getOrders(invite.weekFrom, invite.weekTo);
        const ordersWithItems = await Promise.all(
          ordersList.map(async (order) => {
            const items = await storage.getOrderItems(order.id);
            return { ...order, items };
          })
        );
        const subPat = /meal\s+subscription/i;
        const delPat = /add\s+delivery/i;
        const mealCounts: Record<string, number> = {};
        const extraCounts: Record<string, number> = {};
        for (const order of ordersWithItems) {
          for (const item of order.items) {
            if (subPat.test(item.productName)) continue;
            if (delPat.test(item.productName)) continue;
            if (extraProductNames.has(item.productName)) {
              extraCounts[item.productName] = (extraCounts[item.productName] || 0) + item.quantity;
            } else {
              mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
            }
          }
        }
        availableMeals = Object.entries(mealCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, popularity: count }));
        availableExtras = Object.entries(extraCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, popularity: count }));
      }

      const existingSelections = await storage.getSubscriptionSelections(invite.id);
      res.json({
        customerName: invite.customerName,
        subscriptionQuantity: invite.subscriptionQuantity,
        weekNumber,
        categoryName,
        availableMeals,
        availableExtras,
        selections: existingSelections,
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

      const { selections, extras, subscriptionQuantity } = req.body;
      if (!Array.isArray(selections) || selections.length === 0) {
        return res.status(400).json({ message: "Please select at least one meal" });
      }

      const effectiveMax = subscriptionQuantity && Number.isInteger(subscriptionQuantity) && subscriptionQuantity > 0
        ? subscriptionQuantity
        : invite.subscriptionQuantity;

      if (effectiveMax !== invite.subscriptionQuantity) {
        await storage.updateSubscriptionInviteQuantity(id, effectiveMax);
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
        });
      }

      // Backfill address from order history if the invite was created without one
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
            price: "7.50",
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
            price: "7.50",
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
      const orderItems = await storage.getRecurringOrderItems(id);
      res.json({ ...updated, items: orderItems });
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
        for (const item of order.items) {
          const name = item.productName.toLowerCase();
          if (name.includes("add delivery")) continue;
          revenue += parseFloat(item.price || "0");

          const subMatch = item.productName.match(subscriptionPattern);
          if (subMatch) {
            const mealCount = parseInt(subMatch[1], 10);
            mealsSold += mealCount * item.quantity;
          } else {
            mealsSold += item.quantity;
          }

          mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
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
      const nonSubEntries = mealEntries.filter(([name]) => !subscriptionPattern.test(name));
      if (mealEntries.length > 0) {
        mealEntries.sort((a, b) => b[1] - a[1]);
        topSeller = `${mealEntries[0][0]} (${mealEntries[0][1]})`;
      }
      if (nonSubEntries.length > 0) {
        nonSubEntries.sort((a, b) => a[1] - b[1]);
        worstSeller = `${nonSubEntries[0][0]} (${nonSubEntries[0][1]})`;
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

  startAutoSync();

  return httpServer;
}
