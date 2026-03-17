import { ReplitConnectors } from "@replit/connectors-sdk";
import Stripe from "stripe";

// Replit Connectors SDK – handles auth + token refresh automatically
const connectors = new ReplitConnectors();

export async function getUncachableStripeClient(): Promise<Stripe> {
  // Prefer explicit env secret (fastest path, set via STRIPE_SECRET_KEY secret)
  if (process.env.STRIPE_SECRET_KEY) {
    return new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-01-27.acacia" as any,
    });
  }

  // Use the Replit connector proxy as a custom fetch adapter
  // createProxyFetch routes all Stripe SDK HTTP calls through Replit's proxy
  // which automatically injects authentication headers.
  const proxyFetch = connectors.createProxyFetch("stripe");

  return new Stripe("sk_placeholder_using_replit_proxy", {
    apiVersion: "2025-01-27.acacia" as any,
    httpClient: Stripe.createFetchHttpClient(proxyFetch as typeof fetch),
  });
}

export function getStripePublishableKey(): string {
  return process.env.STRIPE_PUBLISHABLE_KEY || "";
}
