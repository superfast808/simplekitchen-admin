import Stripe from "stripe";

export async function getUncachableStripeClient(secretKey?: string): Promise<Stripe> {
  const key = secretKey || process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "Stripe is not configured. Add a Stripe secret key in Settings or set STRIPE_SECRET_KEY.",
    );
  }

  return new Stripe(key, {
    apiVersion: "2025-01-27.acacia" as any,
  });
}

export function getStripePublishableKey(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}
