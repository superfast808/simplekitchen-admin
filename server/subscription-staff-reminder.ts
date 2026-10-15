import type { Transporter } from "nodemailer";
import { pool } from "./db";

type Dependencies = {
  getSettings: () => Promise<Record<string, string>>;
  getTransporter: () => Promise<Transporter | null>;
  getFromEmail: () => Promise<string>;
  getPortalBaseUrl: () => Promise<string>;
  log: (message: string) => void;
};

type UKDateParts = {
  date: string;
  weekday: string;
  hour: number;
};

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastConfigurationWarning = "";

function londonClock(now = new Date()): UKDateParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)?.value || "";
  return {
    date: part("year") + "-" + part("month") + "-" + part("day"),
    weekday: part("weekday"),
    hour: Number(part("hour")),
  };
}

export function parseSubscriptionStaffRecipients(raw: string): string[] {
  const addresses = [...new Set(raw.split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean))];
  if (addresses.length < 1 || addresses.length > 15 ||
      addresses.some(x => !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))) {
    throw new Error("Enter 1–15 valid staff email addresses separated by commas");
  }
  return addresses;
}

function reminderHtml(portal: string, test: boolean): string {
  const base = portal.replace(/\/+$/, "");
  const subscriptions = base + "/subscriptions";
  const orders = base + "/";
  const kitchen = base + "/kitchen-production";
  const a = (href: string, text: string) =>
    '<a href="' + href.replace(/&/g, "&amp;").replace(/"/g, "&quot;") +
    '" style="color:#176344;font-weight:700;text-decoration:underline">' + text + "</a>";
  return [
    '<div style="background:#f5f7f1;padding:26px 12px;font-family:Arial,Helvetica,sans-serif;color:#233426">',
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #dbe5d7;border-radius:14px;overflow:hidden">',
    '<div style="background:#253f30;color:#fff;padding:24px 28px">',
    '<p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;margin:0 0 8px">SIMPLE KITCHEN · WEEKLY OPERATIONS</p>',
    '<h1 style="font-size:24px;line-height:1.3;margin:0">Thursday subscription check</h1>',
    '</div><div style="padding:26px 28px">',
    test ? '<p style="background:#fff5d6;padding:10px 14px;border-radius:8px"><strong>TEST EMAIL</strong> — this does not count as the weekly reminder.</p>' : "",
    '<p style="font-size:16px">Morning team,</p>',
    '<p>Before finishing this week’s prep, please <strong>double-check that all completed subscriber meal choices are showing in the operational orders</strong>.</p>',
    '<ol style="line-height:1.7;padding-left:21px">',
    '<li>Open ' + a(subscriptions, "Subscriptions → Invites") + '. Check who has chosen their meals.</li>',
    '<li>Open ' + a(orders, "Orders") + '. For each completed subscriber, their <strong>chosen meals must appear as a separate order</strong>, in addition to the basic WooCommerce subscription renewal.</li>',
    '<li>Check ' + a(kitchen, "Kitchen Production") + ' and regenerate/review the delivery labels via Orders, ensuring all subscriber meals are included.</li>',
    '<li>If choices are missing, go back to <strong>Subscriptions → Meal choices → Orders / Labels / Kitchen Production</strong>, select <strong>Review and repair</strong>, check the affected customers, then select <strong>Confirm repair</strong> where appropriate.</li>',
    '<li>Refresh Orders and <strong>regenerate the production sheets and labels</strong>. If anything is still missing or flagged for manual review, resolve it before relying on the totals.</li>',
    '</ol>',
    '<p style="background:#eef5ea;padding:14px;border-radius:8px"><strong>Important:</strong> A paid “Weekly Meal Subscription” line on its own is not the meal selection. The chosen meals must be on their own operational row.</p>',
    '<div style="text-align:center;margin:24px 0"><a href="' + subscriptions + '" style="display:inline-block;background:#2b684a;color:#fff;padding:14px 22px;text-decoration:none;border-radius:8px;font-weight:bold">Check subscriptions now</a></div>',
    '<p>Thanks!<br><strong>Simple Kitchen Admin</strong></p>',
    '</div><div style="border-top:1px solid #e6ece2;padding:14px 28px;font-size:12px;color:#697769">Internal staff reminder · Thursdays at 5:00 am UK time · This email does not send anything to customers or change orders.</div>',
    '</div></div>',
  ].join("");
}

function reminderText(portal: string, test: boolean): string {
  const base = portal.replace(/\/+$/, "");
  return [
    test ? "TEST REMINDER – this is not the scheduled Thursday email." : "SIMPLE KITCHEN – THURSDAY SUBSCRIPTION CHECK",
    "",
    "Morning team,",
    "Please double-check that completed subscriber meal selections show as separate operational orders.",
    "A paid Weekly Meal Subscription renewal by itself is not the chosen meals.",
    "",
    "1. Open Subscriptions → Invites: " + base + "/subscriptions",
    "2. Verify each completed subscriber has a separate chosen-meals row in Orders: " + base + "/",
    "3. Check Kitchen Production and labels include those meals: " + base + "/kitchen-production",
    "4. If any are missing, go to Subscriptions → Meal choices → Orders / Labels / Kitchen Production.",
    "5. Choose Review and repair, inspect affected customers, then Confirm repair where appropriate.",
    "6. Refresh Orders and regenerate the kitchen sheet and delivery labels. Investigate anything still missing.",
    "",
    "Thank you,",
    "Simple Kitchen Admin",
  ].join("\n");
}

async function sendMessage(deps: Dependencies, test: boolean): Promise<{
  accepted: number; recipients: string[];
}> {
  const settings = await deps.getSettings();
  const recipients = parseSubscriptionStaffRecipients(settings.subscription_staff_reminder_recipients || "");
  const transporter = await deps.getTransporter();
  const fromEmail = await deps.getFromEmail();
  if (!transporter || !fromEmail) throw new Error("SMTP is not configured");
  const portal = (await deps.getPortalBaseUrl()).trim();
  if (!/^https?:\/\/[^/\s]+/.test(portal)) throw new Error("Admin portal URL is invalid");
  const result = await transporter.sendMail({
    from: fromEmail,
    to: recipients[0],
    bcc: recipients.slice(1),
    subject: (test ? "[TEST] " : "") + "Simple Kitchen — Thursday subscription order check",
    html: reminderHtml(portal, test),
    text: reminderText(portal, test),
  });
  const accepted = (result.accepted || []).map((r: string) => r.toLowerCase());
  if (recipients.some(r => !accepted.includes(r))) {
    throw new Error("SMTP did not accept all configured staff recipients");
  }
  return { accepted: accepted.length, recipients };
}

export async function sendThursdayReminderTest(deps: Dependencies) {
  // Explicit admin-only action. Does not claim or mark the weekly reminder.
  return sendMessage(deps, true);
}

async function checkAndSend(deps: Dependencies): Promise<void> {
  if (running) return;
  const london = londonClock();
  // Send at 05:00 London time. A small catch-up window, until 07:00, covers
  // short Docker restarts/outages. Autumn/spring DST handled by Intl.
  if (london.weekday !== "Thu" || london.hour < 5 || london.hour >= 7) return;
  running = true;
  try {
    const settings = await deps.getSettings();
    if (settings.subscription_staff_reminder_enabled !== "true") return;
    const recipients = parseSubscriptionStaffRecipients(settings.subscription_staff_reminder_recipients || "");
    // Do not claim a send if SMTP is not configured; retry on subsequent checks.
    if (!(await deps.getTransporter()) || !(await deps.getFromEmail())) {
      if (lastConfigurationWarning !== london.date) {
        deps.log("Thursday staff reminder skipped: SMTP is not configured");
        lastConfigurationWarning = london.date;
      }
      return;
    }
    const client = await pool.connect();
    try {
      const claim = await client.query(
        "INSERT INTO subscription_staff_reminder_runs " +
        "(reminder_date, last_attempt_at, attempts, recipient_emails) " +
        "VALUES ($1, NOW(), 1, $2) " +
        "ON CONFLICT (reminder_date) DO UPDATE SET " +
        "last_attempt_at=NOW(), attempts=subscription_staff_reminder_runs.attempts+1, " +
        "recipient_emails=EXCLUDED.recipient_emails, last_error=NULL " +
        "WHERE subscription_staff_reminder_runs.sent_at IS NULL " +
        "AND subscription_staff_reminder_runs.last_attempt_at < NOW() - INTERVAL '10 minutes' " +
        "RETURNING reminder_date",
        [london.date, recipients.join(", ")]
      );
      if (!claim.rowCount) return;
    } finally {
      client.release();
    }
    try {
      const delivered = await sendMessage(deps, false);
      await pool.query(
        "UPDATE subscription_staff_reminder_runs SET sent_at=NOW(), last_error=NULL WHERE reminder_date=$1",
        [london.date]
      );
      deps.log("Thursday subscription staff reminder accepted by SMTP for " + delivered.accepted + " recipient(s)");
    } catch (error: any) {
      await pool.query(
        "UPDATE subscription_staff_reminder_runs SET last_error=$2 WHERE reminder_date=$1",
        [london.date, String(error?.message || error).slice(0, 1000)]
      ).catch(() => {});
      deps.log("Thursday staff reminder send failed: " + String(error?.message || error));
    }
  } catch (error: any) {
    deps.log("Thursday staff reminder scheduler error: " + String(error?.message || error));
  } finally {
    running = false;
  }
}

export function startThursdaySubscriptionReminder(deps: Dependencies): void {
  if (timer) clearInterval(timer);
  // Poll once per minute rather than schedule UTC 05:00 (which is wrong
  // during British Summer Time). Persisted DB claims prevent duplicate mail.
  timer = setInterval(() => {
    void checkAndSend(deps);
  }, 60 * 1000);
  void checkAndSend(deps); // Catch up if restarted during Thursday 05:00–06:59.
}
