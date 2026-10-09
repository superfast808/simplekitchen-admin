import type { Express } from "express";
import { pool } from "./db";

/**
 * Read-only audit endpoints. Suspected duplicates ALWAYS remain in the production
 * count until staff explicitly correct/cancel the underlying order.
 */
type AuditOrder = {
  id: number; wooId: number | null; customerName: string; customerEmail: string | null;
  orderDate: string; status: string; isManual: boolean; isTuesday: boolean;
  items: { productName: string; quantity: number; price: string; isXmas: boolean }[];
};
const inactiveStatus = (status: string) => ["cancelled", "refunded", "failed", "trash"].includes(status.toLowerCase());
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const itemSignature = (o: AuditOrder) => o.items
  .map(i => [norm(i.productName), i.quantity, Number(i.price || 0).toFixed(2)].join(":"))
  .sort().join("|");

async function getAuditOrders(from: Date, to: Date): Promise<AuditOrder[]> {
  const result = await pool.query(`
    SELECT o.id, o.woo_id AS "wooId", o.customer_name AS "customerName",
           o.customer_email AS "customerEmail", o.order_date AS "orderDate",
           o.status, o.is_manual AS "isManual", o.is_tuesday AS "isTuesday",
           oi.product_name AS "productName", oi.quantity, oi.price,
           (LOWER(COALESCE(p.category, pn.category, '')) LIKE '%xmas%' OR LOWER(COALESCE(p.category, pn.category, '')) LIKE '%christmas%') AS "isXmas"
    FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN LATERAL (SELECT category FROM products WHERE LOWER(TRIM(name)) = LOWER(TRIM(oi.product_name)) AND category IS NOT NULL LIMIT 1) pn ON true
    WHERE o.order_date >= $1 AND o.order_date <= $2 ORDER BY o.id, oi.id
  `, [from, to]);
  const byId = new Map<number, AuditOrder>();
  for (const row of result.rows) {
    let o = byId.get(row.id);
    if (!o) {
      o = {
        id: row.id, wooId: row.wooId, customerName: row.customerName,
        customerEmail: row.customerEmail, orderDate: row.orderDate,
        status: row.status, isManual: row.isManual, isTuesday: row.isTuesday, items: [],
      };
      byId.set(o.id, o);
    }
    if (row.productName != null) o.items.push({
      productName: row.productName, quantity: Number(row.quantity), price: String(row.price || "0"), isXmas: Boolean(row.isXmas),
    });
  }
  return [...byId.values()];
}
function parseWindow(query: Record<string, any>) {
  const from = new Date(String(query.from ?? ""));
  const to = new Date(String(query.to ?? ""));
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) ||
      to < from || to.getTime() - from.getTime() > 40 * 86400000) return null;
  return { from, to };
}
function duplicateGroups(orders: AuditOrder[]) {
  orders = orders.filter(o => !inactiveStatus(o.status));
  const groups: { confidence: "high" | "possible"; reason: string; orders: AuditOrder[] }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < orders.length; i++) for (let j = i + 1; j < orders.length; j++) {
    const a = orders[i], b = orders[j];
    if (!a.items.length || !b.items.length || a.isTuesday !== b.isTuesday) continue;
    if (itemSignature(a) !== itemSignature(b)) continue;
    const sameWoo = a.wooId != null && a.wooId === b.wooId;
    const sameEmail = !!a.customerEmail && norm(a.customerEmail) === norm(b.customerEmail);
    const sameName = !!norm(a.customerName) && norm(a.customerName) === norm(b.customerName);
    const delta = Math.abs(new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
    if (!sameWoo && !(sameEmail || sameName) || (!sameWoo && delta > 20 * 60000)) continue;
    const confidence = sameWoo || (sameEmail && delta <= 5 * 60000) ? "high" : "possible";
    const reason = sameWoo ? "Same WooCommerce order ID and identical items" :
      sameEmail ? "Same email, delivery day and identical items within 20 minutes" :
      "Same customer name, delivery day and identical items within 20 minutes";
    const key = [a.id, b.id].sort((x, y) => x - y).join("-");
    if (!seen.has(key)) { seen.add(key); groups.push({ confidence, reason, orders: [a,b] }); }
  }
  return groups.sort((a,b) => (a.confidence === "high" ? -1 : 1) - (b.confidence === "high" ? -1 : 1));
}
export function registerKitchenAuditRoutes(app: Express) {
  app.get("/api/kitchen-audit", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const window = parseWindow(req.query);
    if (!window) return res.status(400).json({ message: "Supply a valid date range of at most 40 days" });
    try {
      const day = String(req.query.day || "saturday");
      if (!["saturday", "tuesday", "all", "xmas"].includes(day)) return res.status(400).json({ message: "Invalid day" });
      const orders = await getAuditOrders(window.from, window.to);
      // Subscription selections generate manual operational orders; distinguish them
      // from staff-entered manual orders by the linked order IDs.
      const linked=await pool.query(`SELECT selections_order_id AS id FROM subscription_invites WHERE selections_order_id IS NOT NULL
        UNION SELECT tuesday_selections_order_id AS id FROM subscription_invites WHERE tuesday_selections_order_id IS NOT NULL`);
      const subscriptionIds=new Set<number>(linked.rows.map(x=>Number(x.id)));
      const sourceOf=(o:AuditOrder):"woo"|"subscriptions"|"manual" =>
        subscriptionIds.has(o.id)?"subscriptions":o.isManual?"manual":"woo";
      const source=String(req.query.source||"all");
      if(!["all","woo","subscriptions","manual"].includes(source))return res.status(400).json({message:"Invalid source"});
      const selected = orders.filter(o => (source==="all"||sourceOf(o)===source) && (day === "xmas" ? o.items.some(i => i.isXmas) : day === "all" || o.isTuesday === (day === "tuesday")));
      const products = new Map<string, {
        productName: string; required: number; orders: { orderId: number; wooId: number | null; customerName: string; quantity: number; isTuesday: boolean; status: string }[];
      }>();
      for (const o of selected) for (const item of o.items) {
        if (["cancelled","refunded","failed","trash"].includes(o.status.toLowerCase())) continue;
        if (day === "xmas" ? !item.isXmas : item.isXmas) continue;
        const key = item.productName.trim();
        if (!products.has(key)) products.set(key, { productName: key, required: 0, orders: [] });
        const p = products.get(key)!;
        p.required += item.quantity;
        p.orders.push({ orderId: o.id, wooId: o.wooId, customerName: o.customerName,
          quantity: item.quantity, isTuesday: o.isTuesday, status: o.status });
      }
      const sourceTotals={woo:{orders:0,units:0},subscriptions:{orders:0,units:0},manual:{orders:0,units:0}};
      const bySourceProducts:Record<string,Record<string,number>>={woo:{},subscriptions:{},manual:{}};
      for(const o of orders){
        if(inactiveStatus(o.status))continue;
        if(day!=="all"&&day!=="xmas"&&o.isTuesday!==(day==="tuesday"))continue;
        const included=o.items.filter(i=>day==="xmas"?i.isXmas:!i.isXmas);
        if(!included.length)continue;
        const bucket=sourceOf(o);
        sourceTotals[bucket].orders++;
        for(const item of included){
          sourceTotals[bucket].units+=item.quantity;
          bySourceProducts[bucket][item.productName]=(bySourceProducts[bucket][item.productName]||0)+item.quantity;
        }
      }
      // Explain disagreements with the Orders page using the very same order rows:
      // inactive statuses, other delivery day, and regular/Xmas category.
      const diagnostics = new Map<string,{
        productName:string;allRecorded:number;activeAllDays:number;selectedActive:number;
        inactive:number;otherDay:number;records:{orderId:number;wooId:number|null;customerName:string;quantity:number;status:string;day:string;included:boolean;reason:string}[];
      }>();
      for(const o of orders)for(const item of o.items) {
        if (day === "xmas" ? !item.isXmas : item.isXmas) continue;
        const key=norm(item.productName);
        if(!diagnostics.has(key))diagnostics.set(key,{productName:item.productName,allRecorded:0,activeAllDays:0,selectedActive:0,inactive:0,otherDay:0,records:[]});
        const entry=diagnostics.get(key)!;
        const inactive=inactiveStatus(o.status);
        const otherDay=day !== "all" && day !== "xmas" && o.isTuesday !== (day === "tuesday");
        const included=!inactive&&!otherDay;
        entry.allRecorded+=item.quantity;
        if(inactive)entry.inactive+=item.quantity;
        else {
          entry.activeAllDays+=item.quantity;
          if(otherDay)entry.otherDay+=item.quantity;
          else entry.selectedActive+=item.quantity;
        }
        entry.records.push({orderId:o.id,wooId:o.wooId,customerName:o.customerName,quantity:item.quantity,status:o.status,day:o.isTuesday?"Tuesday":"Saturday",included,reason:inactive?"Cancelled/refunded/failed order":otherDay?"Other delivery day":"Included"});
      }
      const manual = await pool.query(`
        SELECT p.name AS "productName", SUM(m.quantity)::int AS quantity
        FROM manual_quantities m JOIN products p ON p.id = m.product_id
        WHERE m.date >= $1 AND m.date <= $2 GROUP BY p.name
      `, [window.from, window.to]);
      // Manual stock isn't attributable to a delivery day. Show it separately,
      // never silently mix it into Saturday or Tuesday allocations.
      res.json({ generatedAt: new Date().toISOString(), day, source, sourceTotals, bySourceProducts, ordersCount: selected.filter(o => !["cancelled","refunded","failed","trash"].includes(o.status.toLowerCase())).length,
        products: [...products.values()].sort((a,b) => a.productName.localeCompare(b.productName)),
        manualStock: day === "xmas" ? [] : manual.rows, reconciliation:[...diagnostics.values()].sort((a,b)=>a.productName.localeCompare(b.productName)), duplicates: duplicateGroups(selected) });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
  app.get("/api/possible-duplicates", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const window = parseWindow(req.query);
    if (!window) return res.status(400).json({ message: "Supply a valid date range of at most 40 days" });
    try {
      const orders = await getAuditOrders(window.from, window.to);
      res.json({ generatedAt: new Date().toISOString(), groups: duplicateGroups(orders),
        note: "Only active orders are flagged. Cancelled or refunded orders remain in order history but are excluded from active duplicate checks." });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });
}
