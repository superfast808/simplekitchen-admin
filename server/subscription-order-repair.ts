import type { Express } from "express";
import type { PoolClient } from "pg";
import { pool } from "./db";

// Operational orders drive the Orders table, kitchen totals and printed labels.
// A completed invite may contain choices even when its stamped order is outside
// the operational week or was never fully created.
type Week = { from: Date; to: Date };
type Invite = {
  id: number; customer_name: string; customer_email: string;
  week_from: Date; week_to: Date; status: string; is_dual: boolean;
  is_tuesday: boolean; selections_order_id: number | null;
  tuesday_selections_order_id: number | null;
  delivery_address: string | null; fulfillment_type: string | null;
};
type Order = {
  id: number; order_date: Date; is_manual: boolean; is_tuesday: boolean;
  woo_id: number | null; status: string; item_count: number;
};
type Finding = {
  inviteId: number; customerName: string; day: "sat" | "tue";
  orderId: number | null;
  issue: "missing" | "empty" | "outside_window" | "wrong_day" | "protected" | "ok";
  canRepair: boolean;
};
const ms = (value: string | Date) => new Date(value).getTime();

function invitationSaturday(invite: Invite): Date {
  const a = ms(invite.week_from), b = ms(invite.week_to);
  const mid = new Date(Number.isFinite(b) && b > a ? (a + b) / 2 : a);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "short",
  }).formatToParts(mid);
  const part = (n: string) => parts.find(p => p.type === n)?.value || "";
  const weekday = ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[part("weekday")];
  const sat = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
  sat.setUTCDate(sat.getUTCDate() - (weekday === 0 ? 1 : weekday === 6 ? 0 : weekday + 1));
  return sat;
}

async function completedInvites(db: PoolClient, week: Week): Promise<Invite[]> {
  const result = await db.query<Invite>(
    "SELECT id, customer_name, customer_email, week_from, week_to, status, is_dual, is_tuesday, " +
    "selections_order_id, tuesday_selections_order_id, delivery_address, fulfillment_type " +
    "FROM subscription_invites WHERE status='completed' " +
    "AND week_to >= $1::timestamp - INTERVAL '18 hours' " +
    "AND week_from <= $2::timestamp + INTERVAL '18 hours' ORDER BY id",
    [week.from, week.to]
  );
  return result.rows.filter(i => invitationSaturday(i).getTime() === week.from.getTime());
}

async function linkedOrder(db: PoolClient, id: number | null): Promise<Order | null> {
  if (!id) return null;
  const result = await db.query<Order>(
    "SELECT o.id, o.order_date, o.is_manual, o.is_tuesday, o.woo_id, o.status, " +
    "COUNT(oi.id)::int AS item_count FROM orders o " +
    "LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.id=$1 GROUP BY o.id",
    [id]
  );
  return result.rows[0] || null;
}

function expectedDays(i: Invite): Array<{ day: "sat" | "tue"; id: number | null }> {
  if (i.is_dual) return [
    { day: "sat", id: i.selections_order_id },
    { day: "tue", id: i.tuesday_selections_order_id },
  ];
  return [{ day: i.is_tuesday ? "tue" : "sat", id: i.selections_order_id }];
}

async function inspect(db: PoolClient, invite: Invite, week: Week): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const day of expectedDays(invite)) {
    const order = await linkedOrder(db, day.id);
    let issue: Finding["issue"] = "ok";
    if (!order) issue = "missing";
    else if (!order.is_manual || order.woo_id != null ||
      ["cancelled", "refunded", "failed", "trash", "delivered"].includes(String(order.status).toLowerCase()))
      issue = "protected";
    else if (order.is_tuesday !== (day.day === "tue")) issue = "wrong_day";
    else if (order.item_count === 0) issue = "empty";
    else if (ms(order.order_date) < week.from.getTime() || ms(order.order_date) > week.to.getTime())
      issue = "outside_window";
    findings.push({
      inviteId: invite.id, customerName: invite.customer_name, day: day.day,
      orderId: order?.id ?? null, issue,
      canRepair: issue === "missing" || issue === "empty" || issue === "outside_window",
    });
  }
  return findings;
}

async function restoreOne(inviteId: number, week: Week, actor: string) {
  const db = await pool.connect();
  const fixed: Array<{ orderId: number; day: string; action: string }> = [];
  const review: string[] = [];
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(39217, $1)", [inviteId]);
    const iResult = await db.query<Invite>(
      "SELECT id, customer_name, customer_email, week_from, week_to, status, is_dual, is_tuesday, " +
      "selections_order_id, tuesday_selections_order_id, delivery_address, fulfillment_type " +
      "FROM subscription_invites WHERE id=$1 FOR UPDATE", [inviteId]
    );
    const i = iResult.rows[0];
    if (!i || i.status !== "completed" || invitationSaturday(i).getTime() !== week.from.getTime()) {
      await db.query("ROLLBACK");
      return { fixed, review: ["Invite is no longer eligible"] };
    }
    const findings = await inspect(db, i, week);
    const stamp = new Date(week.from.getTime() + 14 * 3600000);
    for (const f of findings.filter(x => x.issue !== "ok")) {
      if (!f.canRepair) {
        review.push(i.customer_name + " / " + f.day + " requires manual review (" + f.issue + ")");
        continue;
      }
      const selections = await db.query<{ product_name: string; quantity: number }>(
        "SELECT product_name, quantity FROM subscription_selections " +
        "WHERE invite_id=$1 AND ($3::boolean=FALSE OR delivery_day=$2) ORDER BY id",
        [i.id, f.day, i.is_dual]
      );
      const valid = selections.rows.filter(s => s.product_name?.trim() && Number.isSafeInteger(Number(s.quantity)) && Number(s.quantity) > 0);
      if (!valid.length) {
        review.push(i.customer_name + " / " + f.day + " has no saved selection lines");
        continue;
      }
      let id = f.orderId;
      let action = "";
      if (f.issue === "missing") {
        // Fail closed rather than duplicating an existing unlinked stamped order.
        const duplicates = await db.query(
          "SELECT id FROM orders WHERE is_manual=TRUE AND woo_id IS NULL AND is_tuesday=$3 " +
          "AND order_date >= $4 AND order_date <= $5 " +
          "AND (LOWER(TRIM(COALESCE(customer_email,'')))=LOWER(TRIM($1)) " +
          "OR LOWER(TRIM(customer_name))=LOWER(TRIM($2))) LIMIT 1",
          [i.customer_email, i.customer_name, f.day === "tue",
            new Date(week.from.getTime() - 12 * 3600000), week.to]
        );
        if (duplicates.rows.length) {
          review.push(i.customer_name + " / " + f.day + " has an unlinked manual order; skipped to avoid duplicates");
          continue;
        }
        const inserted = await db.query<{ id: number }>(
          "INSERT INTO orders (customer_name, customer_email, delivery_address, order_date, " +
          "status, fulfillment_type, is_manual, is_tuesday) " +
          "VALUES ($1,$2,$3,$4,'processing',$5,TRUE,$6) RETURNING id",
          [i.customer_name, i.customer_email, i.delivery_address, stamp,
            i.fulfillment_type || "delivery", f.day === "tue"]
        );
        id = inserted.rows[0].id;
        const column = i.is_dual && f.day === "tue" ? "tuesday_selections_order_id" : "selections_order_id";
        await db.query("UPDATE subscription_invites SET " + column + "=$2 WHERE id=$1", [i.id, id]);
        action = "Created missing operational order";
      } else if (f.issue === "outside_window") {
        await db.query("UPDATE orders SET order_date=$2 WHERE id=$1", [id, stamp]);
        action = "Corrected operational week";
      } else {
        action = "Restored empty operational order";
      }
      if (f.issue === "missing" || f.issue === "empty") {
        for (const row of valid) {
          // Subscription payment already belongs to the original subscription.
          // Never create an invoice, Stripe charge or customer notification here.
          await db.query(
            "INSERT INTO order_items (order_id, product_id, product_name, quantity, price) " +
            "VALUES ($1,NULL,$2,$3,'0')", [id, row.product_name, row.quantity]
          );
        }
      }
      await db.query(
        "INSERT INTO order_action_audit (order_id, actor_id, action, details) " +
        "VALUES ($1,$2,'repair_subscription_operational_order',$3)",
        [id, actor, JSON.stringify({ inviteId: i.id, day: f.day, action, previousOrderId: f.orderId })]
      );
      fixed.push({ orderId: id!, day: f.day, action });
    }
    await db.query("COMMIT");
    return { fixed, review };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

export function registerSubscriptionOrderRepair(app: Express, getWeek: (offset: number) => Week) {
  const offsetOf = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isInteger(n) && n >= -3 && n <= 0 ? n : null;
  };
  app.get("/api/subscription-order-health", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
    const offset = offsetOf(req.query.weekOffset);
    if (offset === null) return res.status(400).json({ message: "Invalid week" });
    const db = await pool.connect();
    try {
      const week = getWeek(offset);
      const invites = await completedInvites(db, week);
      const findings = (await Promise.all(invites.map(i => inspect(db, i, week)))).flat();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        weekFrom: week.from, weekTo: week.to,
        completedInvites: invites.length,
        operationalOrders: findings.filter(f => f.issue === "ok").length,
        needsRepair: findings.filter(f => f.canRepair).length,
        needsReview: findings.filter(f => !f.canRepair && f.issue !== "ok").length,
        missingOrders: findings.filter(f => f.issue === "missing").length,
        outsideWindow: findings.filter(f => f.issue === "outside_window").length,
        findings: findings.filter(f => f.issue !== "ok"),
      });
    } catch (error: any) {
      res.status(500).json({ message: String(error?.message || error) });
    } finally {
      db.release();
    }
  });
  app.post("/api/subscription-order-repair", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Not authenticated" });
    if (req.body?.confirm !== "REPAIR_SUBSCRIPTION_ORDERS")
      return res.status(400).json({ message: "Explicit repair confirmation required" });
    const offset = offsetOf(req.body?.weekOffset);
    if (offset === null) return res.status(400).json({ message: "Invalid week" });
    const week = getWeek(offset);
    const db = await pool.connect();
    let ids: number[];
    try {
      ids = (await completedInvites(db, week)).map(i => i.id);
    } catch (error: any) {
      return res.status(500).json({ message: String(error?.message || error) });
    } finally {
      db.release();
    }
    const fixed: Array<{ inviteId: number; orderId: number; day: string; action: string }> = [];
    const review: string[] = [];
    try {
      for (const id of ids) {
        const result = await restoreOne(id, week, String(req.session.userId));
        fixed.push(...result.fixed.map(f => ({ inviteId: id, ...f })));
        review.push(...result.review);
      }
      res.json({ inspected: ids.length, fixed: fixed.length, repairedOrders: fixed, needsReview: review });
    } catch (error: any) {
      res.status(500).json({ message: String(error?.message || error) });
    }
  });
}
