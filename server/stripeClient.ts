import { ReplitConnectors } from "@replit/connectors-sdk";
import Stripe from "stripe";
import { getStripeSync as _getStripeSync, StripeSync } from "stripe-replit-sync";

// Use Replit Connectors SDK to get Stripe credentials
// This handles identity, token refresh, and auth automatically.
const connectors = new ReplitConnectors();

let _stripeSyncInstance: StripeSync | null = null;

export async function getUncachableStripeClient(): Promise<Stripe> {
  const response = await connectors.proxy("stripe", "/v1/account", { method: "GET" });
  const secretKey = (response as any)._secretKey as string | undefined;
  if (secretKey) {
    return new Stripe(secretKey, { apiVersion: "2025-01-27.acacia" as any });
  }
  // Fallback: get key from environment (dev/test)
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("No Stripe secret key available");
  return new Stripe(key, { apiVersion: "2025-01-27.acacia" as any });
}

export async function getStripeSync(): Promise<StripeSync> {
  if (_stripeSyncInstance) return _stripeSyncInstance;
  const stripe = await getUncachableStripeClient();
  _stripeSyncInstance = await _getStripeSync({
    stripeClient: stripe,
    databaseUrl: process.env.DATABASE_URL!,
  });
  return _stripeSyncInstance;
}
