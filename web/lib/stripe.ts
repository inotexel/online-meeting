import Stripe from "stripe";
import { env } from "./env";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    // No explicit apiVersion: the SDK pins its own, and hardcoding a different
    // string here only drifts out of sync with the installed types.
    client = new Stripe(env.stripeSecretKey(), { typescript: true });
  }
  return client;
}

// Stripe's status strings map 1:1 onto our enum; this keeps the cast honest.
const STATUSES = new Set([
  "trialing", "active", "past_due", "canceled", "incomplete",
  "incomplete_expired", "unpaid", "paused",
]);

export function normalizeStatus(status: string): string {
  if (!STATUSES.has(status)) {
    throw new Error(`Unrecognized Stripe subscription status: ${status}`);
  }
  return status;
}

export function toIso(seconds: number | null | undefined): string | null {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}
