import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fetchWooOrders, fetchWooProducts, decodeHtmlEntities } from "./woocommerce";
import { insertProductSchema, insertIngredientSchema, insertOrderSchema, insertOrderItemSchema, insertManualQuantitySchema } from "@shared/schema";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import multer from "multer";
import bcrypt from "bcrypt";
import { log } from "./index";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
      const { items, ...orderData } = req.body;
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
      const orderItems = await storage.getOrderItems(order.id);
      res.json({ ...order, items: orderItems });
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
      const items = await storage.getOrderItemsByDateRange(from, to);
      const manualQtys = await storage.getManualQuantities(from, to);

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
      const items = await storage.getOrderItemsByDateRange(from, to);
      const manualQtys = await storage.getManualQuantities(from, to);
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
      const items = await storage.getOrderItemsByDateRange(from, to);
      const manualQtys = await storage.getManualQuantities(from, to);
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
      const ordersList = await storage.getOrders(from, to);
      const ordersWithItems = await Promise.all(
        ordersList.map(async (order) => {
          const items = await storage.getOrderItems(order.id);
          return { ...order, items };
        })
      );
      applyAddDeliveryUpgrades(ordersWithItems);
      const addresses = ordersWithItems
        .filter(o => o.deliveryAddress)
        .map(o => ({
          id: o.id,
          customerName: o.customerName,
          address: o.deliveryAddress,
          lat: o.deliveryLat ? parseFloat(o.deliveryLat) : null,
          lng: o.deliveryLng ? parseFloat(o.deliveryLng) : null,
          fulfillment: (o.fulfillmentType || "collection") as "delivery" | "collection",
        }));
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

      const PT = 2.83465;
      const pageW = 210 * PT;
      const pageH = 297 * PT;
      const labelW = 99.1 * PT;
      const labelH = 57 * PT;
      const cols = 2;
      const rows = 5;
      const marginLeft = (pageW - cols * labelW) / 2;
      const marginTop = (pageH - rows * labelH) / 2;
      const padX = 6 * PT;
      const padY = 4 * PT;

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
        const x = marginLeft + col * labelW + padX;
        const y = marginTop + row * labelH + padY;
        const contentW = labelW - padX * 2;
        const contentH = labelH - padY * 2;

        doc.save();
        doc.rect(marginLeft + col * labelW, marginTop + row * labelH, labelW, labelH).clip();

        const isDelivery = order.fulfillmentType === "delivery";
        const tag = isDelivery ? "DELIVERY" : "COLLECTION";

        doc.font("Helvetica-Bold").fontSize(11);
        doc.text(order.customerName, x, y, { width: contentW, lineBreak: true });

        let currentY = doc.y + 1;

        doc.font("Helvetica-Bold").fontSize(7);
        const tagText = `[ ${tag} ]`;
        doc.text(tagText, x, currentY, { width: contentW });
        currentY = doc.y + 2;

        if (order.deliveryAddress) {
          doc.font("Helvetica").fontSize(8);
          doc.text(order.deliveryAddress, x, currentY, { width: contentW, lineBreak: true });
          currentY = doc.y + 3;
        }

        const itemSummary: Record<string, number> = {};
        for (const item of order.items) {
          const name = item.productName;
          if (name.toLowerCase().includes("add delivery")) continue;
          itemSummary[name] = (itemSummary[name] || 0) + item.quantity;
        }
        const summaryParts = Object.entries(itemSummary).map(([name, qty]) => `${qty} x ${name}`);
        if (summaryParts.length > 0) {
          doc.font("Helvetica").fontSize(7);
          const maxSummaryH = (marginTop + row * labelH + labelH - padY) - currentY;
          if (maxSummaryH > 8) {
            doc.text(summaryParts.join(", "), x, currentY, {
              width: contentW,
              height: maxSummaryH,
              lineBreak: true,
              ellipsis: true,
            });
          }
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

      for (const order of ordersWithItems) {
        for (const item of order.items) {
          const name = item.productName.toLowerCase();
          if (name.includes("add delivery")) continue;
          mealsSold += item.quantity;
          revenue += parseFloat(item.price || "0");
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

  startAutoSync();

  return httpServer;
}
