import type { Express, Request } from "express";
import { pool } from "./db";

/**
 * Sale-or-return tracking for shops that are also consistent customers.
 *
 * "Supplied" is never typed in: it is read live from the shop's stamped
 * (manual) orders in the operational week, so amending or re-stamping an
 * order is reflected immediately. Staff only record what was sold and what
 * came back. Counts are keyed by shop name + week + day + product, NOT by
 * order id, so "Remove All Stamps" followed by a re-stamp keeps the counts.
 */

type Week = { from: Date; to: Date };
type Day = "sat" | "tue";

const INACTIVE_STATUSES = ["cancelled", "refunded", "failed", "trash"];
const HISTORY_WEEKS = 6;

export const shopKey = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const productKey = shopKey;
const SQL_KEY = (col: string) => `LOWER(REGEXP_REPLACE(TRIM(${col}), '\\s+', ' ', 'g'))`;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const toPence = (price: unknown) => {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

function parseCount(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 9999) throw new Error("Counts must be whole numbers from 0 to 9999");
  return n;
}

function parsePricePence(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw new Error("Price must be between £0 and £1000");
  return n;
}

export async function setupShopReturnTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_sor_shops (
      name_key text PRIMARY KEY,
      display_name text NOT NULL,
      price_per_item_pence integer,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_sor_counts (
      name_key text NOT NULL,
      week_start date NOT NULL,
      day text NOT NULL CHECK (day IN ('sat','tue')),
      product_key text NOT NULL,
      product_name text NOT NULL,
      sold integer CHECK (sold IS NULL OR sold >= 0),
      returned integer CHECK (returned IS NULL OR returned >= 0),
      updated_at timestamptz NOT NULL DEFAULT NOW(),
      updated_by text,
      PRIMARY KEY (name_key, week_start, day, product_key)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_shop_sor_counts_week ON shop_sor_counts (week_start)`);
}

type Line = {
  productName: string; productKey: string; supplied: number;
  sold: number | null; returned: number | null; unitPricePence: number;
};

function summarise(lines: Line[]) {
  let supplied = 0, sold = 0, returned = 0, toCount = 0, owedPence = 0;
  for (const l of lines) {
    supplied += l.supplied;
    sold += l.sold ?? 0;
    returned += l.returned ?? 0;
    owedPence += (l.sold ?? 0) * l.unitPricePence;
    toCount += Math.max(0, l.supplied - (l.sold ?? 0) - (l.returned ?? 0));
  }
  return { supplied, sold, returned, toCount, owedPence };
}

export function registerShopReturns(app: Express, getWeekRange: (offset?: number) => Week) {
  const userOf = (req: Request) => String((req.session as any)?.userId ?? "");

  async function listShops() {
    const { rows } = await pool.query(
      `SELECT name_key AS key, display_name AS name, price_per_item_pence AS "pricePerItemPence"
       FROM shop_sor_shops ORDER BY display_name`,
    );
    return rows as { key: string; name: string; pricePerItemPence: number | null }[];
  }

  app.get("/api/shop-returns/shops", async (_req, res) => {
    try {
      const shops = await listShops();
      const { rows } = await pool.query(`
        SELECT DISTINCT ON (${SQL_KEY("customer_name")}) ${SQL_KEY("customer_name")} AS key, TRIM(customer_name) AS name
        FROM recurring_orders ORDER BY ${SQL_KEY("customer_name")}, id
      `);
      res.json({ shops, consistentCustomers: rows });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/shop-returns/shops", async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name.trim().replace(/\s+/g, " ") : "";
      if (!name) return res.status(400).json({ message: "Shop name is required" });
      const price = parsePricePence(req.body?.pricePerItemPence);
      await pool.query(
        `INSERT INTO shop_sor_shops (name_key, display_name, price_per_item_pence) VALUES ($1, $2, $3)
         ON CONFLICT (name_key) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [shopKey(name), name, price],
      );
      res.json({ shops: await listShops() });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/shop-returns/shops/:key", async (req, res) => {
    try {
      if (!("pricePerItemPence" in (req.body ?? {}))) return res.status(400).json({ message: "Nothing to update" });
      const price = parsePricePence(req.body.pricePerItemPence);
      const r = await pool.query(`UPDATE shop_sor_shops SET price_per_item_pence = $2 WHERE name_key = $1`, [req.params.key, price]);
      if (r.rowCount === 0) return res.status(404).json({ message: "Shop not found" });
      res.json({ shops: await listShops() });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // Removing a shop only hides it. Its counts stay so re-adding restores history.
  app.delete("/api/shop-returns/shops/:key", async (req, res) => {
    try {
      await pool.query(`DELETE FROM shop_sor_shops WHERE name_key = $1`, [req.params.key]);
      res.json({ shops: await listShops() });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/shop-returns/week", async (req, res) => {
    try {
      const offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
      if (!Number.isInteger(offset) || offset < -260 || offset > 4) {
        return res.status(400).json({ message: "Invalid week" });
      }
      const shops = await listShops();
      // weeks[0] is the selected week, weeks[1..] go back in time for history.
      const weeks = Array.from({ length: HISTORY_WEEKS + 1 }, (_, i) => {
        const w = getWeekRange(offset - i);
        return { ...w, start: isoDate(w.from) };
      });
      const current = weeks[0];
      const base = { week: { offset, start: current.start, from: current.from, to: current.to } };
      if (shops.length === 0) return res.json({ ...base, shops: [] });

      const keys = shops.map(s => s.key);
      const earliest = weeks[weeks.length - 1].from;

      const [orderRows, countRows, productRows, recurringRows] = await Promise.all([
        pool.query(`
          SELECT o.id, ${SQL_KEY("o.customer_name")} AS key, o.order_date AS "orderDate", o.is_tuesday AS "isTuesday",
                 oi.product_name AS "productName", oi.quantity
          FROM orders o JOIN order_items oi ON oi.order_id = o.id
          WHERE o.is_manual = true
            AND ${SQL_KEY("o.customer_name")} = ANY($1)
            AND o.order_date >= $2 AND o.order_date <= $3
            AND LOWER(o.status) <> ALL($4)
        `, [keys, earliest, current.to, INACTIVE_STATUSES]),
        pool.query(`
          SELECT name_key AS key, to_char(week_start, 'YYYY-MM-DD') AS "weekStart", day,
                 product_key AS "productKey", product_name AS "productName", sold, returned
          FROM shop_sor_counts WHERE name_key = ANY($1) AND week_start = ANY($2::date[])
        `, [keys, weeks.map(w => w.start)]),
        pool.query(`SELECT name, price FROM products`),
        pool.query(`SELECT ${SQL_KEY("customer_name")} AS key, is_tuesday AS "isTuesday" FROM recurring_orders WHERE active = true AND ${SQL_KEY("customer_name")} = ANY($1)`, [keys]),
      ]);

      const catalogue = new Map<string, number>();
      for (const p of productRows.rows) {
        const k = productKey(String(p.name));
        catalogue.set(k, Math.max(catalogue.get(k) ?? 0, toPence(p.price)));
      }

      // bucket: shop|weekStart|day -> productKey -> line
      type Bucket = Map<string, { productName: string; supplied: number; sold: number | null; returned: number | null }>;
      const buckets = new Map<string, Bucket>();
      const bucket = (k: string, start: string, day: Day) => {
        const id = `${k}|${start}|${day}`;
        let b = buckets.get(id);
        if (!b) { b = new Map(); buckets.set(id, b); }
        return b;
      };
      const stampedOrders = new Map<string, Set<number>>();
      for (const r of orderRows.rows) {
        const t = new Date(r.orderDate).getTime();
        const w = weeks.find(w => t >= w.from.getTime() && t <= w.to.getTime());
        if (!w || !r.productName) continue;
        const day: Day = r.isTuesday ? "tue" : "sat";
        const id = `${r.key}|${w.start}|${day}`;
        if (!stampedOrders.has(id)) stampedOrders.set(id, new Set());
        stampedOrders.get(id)!.add(r.id);
        const b = bucket(r.key, w.start, day);
        const pk = productKey(r.productName);
        const line = b.get(pk) ?? { productName: String(r.productName).trim(), supplied: 0, sold: null, returned: null };
        line.supplied += Number(r.quantity) || 0;
        b.set(pk, line);
      }
      for (const c of countRows.rows) {
        const b = bucket(c.key, c.weekStart, c.day);
        const line = b.get(c.productKey) ?? { productName: c.productName, supplied: 0, sold: null, returned: null };
        line.sold = c.sold;
        line.returned = c.returned;
        b.set(c.productKey, line);
      }

      const usualDays = new Map<string, Set<Day>>();
      for (const r of recurringRows.rows) {
        if (!usualDays.has(r.key)) usualDays.set(r.key, new Set());
        usualDays.get(r.key)!.add(r.isTuesday ? "tue" : "sat");
      }

      const result = shops.map(shop => {
        const priceFor = (pk: string) => shop.pricePerItemPence ?? catalogue.get(pk) ?? 0;
        const linesFor = (start: string, day: Day): Line[] => {
          const b = buckets.get(`${shop.key}|${start}|${day}`);
          if (!b) return [];
          return Array.from(b.entries())
            .map(([pk, l]) => ({ ...l, productKey: pk, unitPricePence: priceFor(pk) }))
            .sort((a, b) => a.productName.localeCompare(b.productName));
        };
        const drops = (["sat", "tue"] as Day[])
          .filter(day => usualDays.get(shop.key)?.has(day) || buckets.has(`${shop.key}|${current.start}|${day}`))
          .map(day => {
            const lines = linesFor(current.start, day);
            return {
              day,
              stamped: (stampedOrders.get(`${shop.key}|${current.start}|${day}`)?.size ?? 0) > 0,
              lines,
              totals: summarise(lines),
            };
          });
        const history = weeks.slice(1).map(w => {
          const lines = [...linesFor(w.start, "sat"), ...linesFor(w.start, "tue")];
          const t = summarise(lines);
          return { weekStart: w.start, supplied: t.supplied, sold: t.sold, returned: t.returned, toCount: t.toCount };
        }).reverse();
        return {
          ...shop,
          drops,
          totals: summarise(drops.flatMap(d => d.lines)),
          history,
        };
      });

      res.json({ ...base, shops: result });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Save one or more product counts for a shop's Saturday or Tuesday drop.
  // A line with both values cleared is removed so it reads as "not counted".
  app.put("/api/shop-returns/counts", async (req, res) => {
    const client = await pool.connect();
    try {
      const { shopKey: key, weekStart, day, lines } = req.body ?? {};
      if (typeof key !== "string" || !key) return res.status(400).json({ message: "Shop is required" });
      if (typeof weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || Number.isNaN(Date.parse(weekStart))) {
        return res.status(400).json({ message: "Invalid week" });
      }
      if (day !== "sat" && day !== "tue") return res.status(400).json({ message: "Day must be sat or tue" });
      if (!Array.isArray(lines) || lines.length === 0 || lines.length > 200) return res.status(400).json({ message: "No counts to save" });
      const shop = await client.query(`SELECT 1 FROM shop_sor_shops WHERE name_key = $1`, [key]);
      if (shop.rowCount === 0) return res.status(404).json({ message: "Shop not found" });

      const parsed = lines.map((l: any) => {
        const productName = typeof l?.productName === "string" ? l.productName.trim() : "";
        if (!productName) throw new Error("Product name is required");
        return { productName, pk: productKey(productName), sold: parseCount(l.sold) ?? null, returned: parseCount(l.returned) ?? null };
      });

      await client.query("BEGIN");
      for (const l of parsed) {
        if (l.sold === null && l.returned === null) {
          await client.query(
            `DELETE FROM shop_sor_counts WHERE name_key=$1 AND week_start=$2 AND day=$3 AND product_key=$4`,
            [key, weekStart, day, l.pk],
          );
        } else {
          await client.query(`
            INSERT INTO shop_sor_counts (name_key, week_start, day, product_key, product_name, sold, returned, updated_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            ON CONFLICT (name_key, week_start, day, product_key) DO UPDATE
            SET sold = EXCLUDED.sold, returned = EXCLUDED.returned, product_name = EXCLUDED.product_name,
                updated_at = NOW(), updated_by = EXCLUDED.updated_by
          `, [key, weekStart, day, l.pk, l.productName, l.sold, l.returned, userOf(req)]);
        }
      }
      await client.query("COMMIT");
      res.json({ saved: parsed.length });
    } catch (e: any) {
      await client.query("ROLLBACK").catch(() => {});
      res.status(400).json({ message: e.message });
    } finally {
      client.release();
    }
  });
}
