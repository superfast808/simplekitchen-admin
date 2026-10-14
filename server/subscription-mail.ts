import type { Transporter } from "nodemailer";
import { storage } from "./storage";

export type SubscriptionMailContext = {
  transporter: Transporter;
  fromEmail: string;
  baseUrl: string;
  subject: string;
  body: string;
};

export type InviteMailResult = "sent" | "skipped" | "failed";

// SMTP accepted is not proof of delivery to the customer's inbox.
// Claim before sending to avoid duplicate concurrent retries.
export async function sendTrackedSubscriptionInvite(
  invite: {
    id: number; status: string; token: string; customerEmail: string;
    customerName: string; subscriptionQuantity: number;
  },
  mail: SubscriptionMailContext,
  options: { dayLabel?: string; overrideEmail?: string; force?: boolean } = {},
): Promise<InviteMailResult> {
  const override = String(options.overrideEmail || "").trim();
  const recipient = override || String(invite.customerEmail || "").trim();
  if (!override && !(await storage.claimSubscriptionInviteEmail(invite.id, options.force === true))) {
    return "skipped";
  }
  if (!recipient) {
    if (!override) await storage.updateSubscriptionInviteEmailDelivery(invite.id, {
      lastError: "No customer email address",
    });
    return "failed";
  }

  const firstName = String(invite.customerName || "").trim().split(" ")[0];
  const url = mail.baseUrl + "/subscribe/" + invite.token;
  const interpolate = (template: string) => template
    .replace(/\{\{firstName\}\}/g, firstName)
    .replace(/\{\{fullName\}\}/g, String(invite.customerName || ""))
    .replace(/\{\{qty\}\}/g, String(invite.subscriptionQuantity))
    .replace(/\{\{url\}\}/g, url);

  try {
    const result = await mail.transporter.sendMail({
      from: mail.fromEmail,
      to: recipient,
      subject: interpolate(mail.subject) + (options.dayLabel || ""),
      html: '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">'
        + interpolate(mail.body) + "</div>",
    });
    const accepted: string[] = Array.isArray(result.accepted) ? result.accepted : [];
    if (!accepted.some(address => address.toLowerCase() === recipient.toLowerCase())) {
      throw new Error("SMTP did not accept the recipient");
    }
    // Test overrides must not update actual customer delivery status.
    if (!override) await storage.updateSubscriptionInviteEmailDelivery(invite.id, {
      sentAt: new Date(), lastError: null, legacy: false,
    });
    return "sent";
  } catch (error: any) {
    const message = String(error?.message || error).slice(0, 1000);
    if (!override) await storage.updateSubscriptionInviteEmailDelivery(invite.id, {
      lastError: message,
    });
    console.error("Subscription invite SMTP failed", { inviteId: invite.id, message });
    return "failed";
  }
}
