import { ReplitConnectors } from "@replit/connectors-sdk";
import Stripe from "stripe";

const connectors = new ReplitConnectors();

export async function getUncachableStripeClient(secretKey?: string): Promise<Stripe> {
  const key = secretKey || process.env.STRIPE_SECRET_KEY;
  if (key) {
    return new Stripe(key, {
      apiVersion: "2025-01-27.acacia" as any,
    });
  }

  const proxyFetch = connectors.createProxyFetch("stripe");
  return new Stripe("sk_placeholder_using_replit_proxy", {
    apiVersion: "2025-01-27.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(proxyFetch as typeof fetch),
  });
}

export function getStripePublishableKey(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}
