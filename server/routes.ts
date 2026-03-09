import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { fetchWooOrders, fetchWooProducts, decodeHtmlEntities } from "./woocommerce";
import { insertProductSchema, insertIngredientSchema, insertOrderSchema, insertOrderItemSchema, insertManualQuantitySchema } from "@shared/schema";
import * as XLSX from "xlsx";
import { log } from "./index";

let syncInterval: ReturnType<typeof setInterval> | null = null;
let syncInProgress = false;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

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

      const orderData = {
        wooId: wo.id,
        customerName,
        customerEmail: billing.email || null,
        deliveryAddress: address || null,
        deliveryLat: null,
        deliveryLng: null,
        orderDate: new Date(wo.date_created),
        status: wo.status,
        isManual: false,
      };

      if (existing) {
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

        const orderData = {
          wooId: wo.id,
          customerName,
          customerEmail: billing.email || null,
          deliveryAddress: address || null,
          deliveryLat: null,
          deliveryLng: null,
          orderDate: new Date(wo.date_created),
          status: wo.status,
          isManual: false,
        };

        if (existing) {
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
      const addresses = await Promise.all(
        ordersList
          .filter(o => o.deliveryAddress)
          .map(async (o) => {
            const items = await storage.getOrderItems(o.id);
            const hasDelivery = items.some(i => i.productName.toLowerCase().includes("add delivery"));
            return {
              id: o.id,
              customerName: o.customerName,
              address: o.deliveryAddress,
              lat: o.deliveryLat ? parseFloat(o.deliveryLat) : null,
              lng: o.deliveryLng ? parseFloat(o.deliveryLng) : null,
              fulfillment: hasDelivery ? "delivery" as const : "collection" as const,
            };
          })
      );
      res.json(addresses);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/geocode", async (req, res) => {
    try {
      const { address, orderId } = req.body;
      if (!address) return res.status(400).json({ message: "Address is required" });
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
        { headers: { "User-Agent": "PartnerPortal/1.0" } }
      );
      const data = await response.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (orderId) {
          await storage.updateOrder(parseInt(orderId), {
            deliveryLat: String(lat),
            deliveryLng: String(lng),
          });
        }
        res.json({ lat, lng });
      } else {
        res.json({ lat: null, lng: null });
      }
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

  startAutoSync();

  return httpServer;
}
