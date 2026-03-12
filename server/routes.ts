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

const DEFAULT_SETTINGS: Record<string, string> = {
  sync_interval_minutes: "60",
  sync_enabled: "true",
  order_window_open_day: "6",
  order_window_open_hour: "12",
  order_window_close_day: "3",
  order_window_close_hour: "24",
};

const ALLOWED_SETTINGS_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const MIN_SYNC_INTERVAL = 5;
const MAX_SYNC_INTERVAL = 1440;

async function getSettingsMap(): Promise<Record<string, string>> {
  const allSettings = await storage.getAllSettings();
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const s of allSettings) {
    map[s.key] = s.value;
  }
  return map;
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

    log(`Auto-sync complete: imported=${imported}, updated=${updated}, total=${wooOrders.length}`, "sync");
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

      const productQuantities: Record<number, number> = {};
      for (const item of items) {
        if (item.productId) {
          productQuantities[item.productId] = (productQuantities[item.productId] || 0) + item.quantity;
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

      const productQuantities: Record<number, number> = {};
      for (const item of items) {
        if (item.productId) {
          productQuantities[item.productId] = (productQuantities[item.productId] || 0) + item.quantity;
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
      const addresses = ordersWithItems
        .filter(o => o.deliveryAddress)
        .map(o => {
          const fulfillment = (o.fulfillmentType === "delivery" || (!o.fulfillmentType && o.deliveryAddress))
            ? "delivery"
            : "collection";
          return {
            id: o.id,
            customerName: o.customerName,
            address: o.deliveryAddress,
            lat: o.deliveryLat ? parseFloat(o.deliveryLat) : null,
            lng: o.deliveryLng ? parseFloat(o.deliveryLng) : null,
            fulfillment: fulfillment as "delivery" | "collection",
            isManual: o.isManual,
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
      const ordersList = await storage.getOrders(from, to);
      const ordersWithItems = await Promise.all(
        ordersList.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);

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
      for (const order of ordersWithItems) {
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

        // Pre-measure each section to enable vertical centering
        const GAP1 = 1.5;  // gap after name
        const GAP2 = 1.5;  // gap after tag
        const GAP3 = 2;    // gap after address

        doc.font("Helvetica-Bold").fontSize(9);
        const nameH = doc.heightOfString(order.customerName, { width: innerW });

        doc.font("Helvetica-Bold").fontSize(7);
        const tagH = doc.heightOfString(tag, { width: innerW });

        doc.font("Helvetica").fontSize(7);
        const addrText = order.deliveryAddress || "";
        const addrH = addrText ? doc.heightOfString(addrText, { width: innerW }) : 0;

        doc.font("Helvetica").fontSize(6.5);
        const itemsH = summaryText ? doc.heightOfString(summaryText, { width: innerW }) : 0;

        const totalContentH =
          nameH + GAP1 +
          tagH  + GAP2 +
          (addrH  > 0 ? addrH  + GAP3 : 0) +
          (itemsH > 0 ? itemsH         : 0);

        // Vertically center the block; never start above top padding
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
          const maxAddrH = labelY + labelH - cy - (itemsH > 0 ? itemsH + GAP3 + 4 : 4);
          if (maxAddrH > 7) {
            doc.text(addrText, cx, cy, { ...opts, height: maxAddrH, ellipsis: true });
            cy = doc.y + GAP3;
          }
        }

        // Items
        if (summaryText && cy < labelY + labelH - 6) {
          doc.font("Helvetica").fontSize(6.5);
          const maxItemH = labelY + labelH - cy - 2;
          doc.text(summaryText, cx, cy, { ...opts, height: maxItemH, ellipsis: true });
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
      saturdayDate.setDate(saturdayDate.getDate() - daysBack);
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

  const smtpTransporter = process.env.SMTP_HOST ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: parseInt(process.env.SMTP_PORT || "587") === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  }) : null;

  app.post("/api/subscription-invites/send", async (req, res) => {
    try {
      if (!smtpTransporter) {
        return res.status(500).json({ message: "SMTP not configured" });
      }
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

      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const baseUrl = `${protocol}://${host}`;

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
        await storage.createSubscriptionInvite({
          orderId: order.id,
          customerEmail: order.customerEmail || "",
          customerName: order.customerName,
          token,
          subscriptionQuantity: qty,
          status: "pending",
          weekFrom: week.from,
          weekTo: week.to,
        });

        const selectUrl = `${baseUrl}/subscribe/${token}`;
        const toEmail = overrideEmail || order.customerEmail;
        if (!toEmail) {
          errors.push(`No email for ${order.customerName}`);
          continue;
        }

        try {
          await smtpTransporter.sendMail({
            from: process.env.SMTP_FROM_EMAIL,
            to: toEmail,
            subject: "Choose Your Meals This Week - Simple Kitchen Prep",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #333;">Hi ${order.customerName.split(" ")[0]},</h2>
                <p>It's time to choose your <strong>${qty} meals</strong> for this week!</p>
                <p>Click the button below to select your preferences:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${selectUrl}" style="background-color: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-size: 16px; font-weight: bold;">Choose My Meals</a>
                </div>
                <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="color: #666; font-size: 12px; word-break: break-all;">${selectUrl}</p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;" />
                <p style="color: #999; font-size: 12px;">Simple Kitchen Prep</p>
              </div>
            `,
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

      // Use products table as canonical source for meal vs extra classification
      const allProducts = await storage.getProducts();
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
          if (mealProductNames.has(item.productName)) {
            mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
          } else if (extraProductNames.has(item.productName)) {
            extraCounts[item.productName] = (extraCounts[item.productName] || 0) + item.quantity;
          }
        }
      }

      const availableMeals = Object.entries(mealCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, popularity: count }));
      const availableExtras = Object.entries(extraCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, popularity: count }));

      const existingSelections = await storage.getSubscriptionSelections(invite.id);

      res.json({
        customerName: invite.customerName,
        subscriptionQuantity: invite.subscriptionQuantity,
        status: invite.status,
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

      const order = await storage.createOrder({
        customerName: invite.customerName,
        customerEmail: invite.customerEmail,
        deliveryAddress: null,
        orderDate: new Date(),
        status: "processing",
        fulfillmentType: "delivery",
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

      // Use products table as canonical source for meal vs extra classification
      const allProducts = await storage.getProducts();
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
          if (mealProductNames.has(item.productName)) {
            mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
          } else if (extraProductNames.has(item.productName)) {
            extraCounts[item.productName] = (extraCounts[item.productName] || 0) + item.quantity;
          }
        }
      }

      const availableMeals = Object.entries(mealCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, popularity: count }));
      const availableExtras = Object.entries(extraCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, popularity: count }));

      const existingSelections = await storage.getSubscriptionSelections(invite.id);
      res.json({
        customerName: invite.customerName,
        subscriptionQuantity: invite.subscriptionQuantity,
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

      if (invite.selectionsOrderId) {
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
          deliveryAddress: null,
          orderDate: new Date(),
          status: "processing",
          fulfillmentType: "delivery",
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

      const updated = await storage.updateRecurringOrder(id, orderUpdate);

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
