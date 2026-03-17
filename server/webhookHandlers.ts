import { getUncachableStripeClient } from "./stripeClient";
import { storage } from "./storage";

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
        "This usually means express.json() ran before this handler. " +
        "FIX: Register webhook route BEFORE app.use(express.json())."
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET environment variable is not set");
    }

    const stripe = await getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const inviteId = session.metadata?.inviteId ? parseInt(session.metadata.inviteId) : null;
        if (inviteId && session.payment_status === "paid") {
          await storage.updateSubscriptionInvitePayment(inviteId, { addonPaid: true });
        }
        break;
      }
      case "payment_intent.succeeded": {
        const pi = event.data.object as any;
        const inviteId = pi.metadata?.inviteId ? parseInt(pi.metadata.inviteId) : null;
        if (inviteId) {
          await storage.updateSubscriptionInvitePayment(inviteId, { addonPaid: true });
        }
        break;
      }
      default:
        break;
    }
  }
}
