import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, normalizeStatus, toIso } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";

// The webhook is the ONLY writer of subscription state. Nothing else may mark a
// user as paid — that keeps Stripe as the single source of truth.

const HANDLED = new Set<Stripe.Event.Type>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  // Must be the raw body — any JSON round-trip breaks signature verification.
  const payload = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, env.stripeWebhookSecret());
  } catch (err) {
    // A bad signature means the request did not come from Stripe. Never process it.
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: `Invalid signature: ${message}` }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // 200 so Stripe stops retrying events we intentionally ignore.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        break;
    }
  } catch (err) {
    // 500 makes Stripe retry with backoff, which is what we want for a transient
    // DB failure. Handlers below are idempotent so replays are safe.
    const message = err instanceof Error ? err.message : "unknown";
    console.error(`[stripe:${event.type}] ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Checkout can be started by a logged-out visitor, so this is where an account
 * gets created if one does not exist yet. The user is invited by email to set a
 * password; Pro unlocks in the app the moment they sign in there.
 */
async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const email = session.customer_details?.email ?? session.customer_email;
  if (!customerId || !email) {
    throw new Error("checkout.session.completed missing customer or email");
  }

  const userId = await resolveUserId(customerId, email, session.metadata?.user_id);

  // The subscription object arrives in its own event too, but ordering is not
  // guaranteed, so record it here as well. Both paths are idempotent.
  if (session.subscription) {
    const subId =
      typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    const subscription = await stripe().subscriptions.retrieve(subId);
    await upsertSubscription(userId, subscription);
  }
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  const db = supabaseAdmin();
  const { data: profile, error } = await db
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw new Error(`Profile lookup failed: ${error.message}`);
  if (!profile) {
    // Subscription for a customer we have never seen. Fetch the email from
    // Stripe and provision, rather than dropping the event on the floor.
    const customer = await stripe().customers.retrieve(customerId);
    if (customer.deleted) throw new Error(`Customer ${customerId} is deleted`);
    if (!customer.email) throw new Error(`Customer ${customerId} has no email`);
    const userId = await resolveUserId(customerId, customer.email);
    await upsertSubscription(userId, subscription);
    return;
  }

  await upsertSubscription(profile.id, subscription);
}

async function upsertSubscription(userId: string, subscription: Stripe.Subscription) {
  const item = subscription.items.data[0];
  const { error } = await supabaseAdmin().from("subscriptions").upsert({
    id: subscription.id,
    user_id: userId,
    status: normalizeStatus(subscription.status),
    price_id: item?.price.id ?? "unknown",
    quantity: item?.quantity ?? 1,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_end: toIso(subscription.current_period_end),
    trial_end: toIso(subscription.trial_end),
  });
  if (error) throw new Error(`Subscription upsert failed: ${error.message}`);
}

/**
 * Find or create the Supabase user for a Stripe customer, and make sure the
 * profile carries the customer id so future events resolve by lookup.
 */
async function resolveUserId(
  customerId: string,
  email: string,
  metadataUserId?: string
): Promise<string> {
  const db = supabaseAdmin();

  if (metadataUserId) {
    await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", metadataUserId);
    return metadataUserId;
  }

  const { data: byCustomer } = await db
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (byCustomer) return byCustomer.id;

  const { data: byEmail } = await db
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (byEmail) {
    await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", byEmail.id);
    return byEmail.id;
  }

  // Brand-new paying customer who never signed up on the site. Invite them so
  // they can set a password and sign in from the desktop app.
  const { data: invited, error: inviteError } =
    await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${env.siteUrl()}/auth/callback?next=/account`,
    });
  if (inviteError || !invited.user) {
    throw new Error(`Could not provision user for ${email}: ${inviteError?.message}`);
  }

  await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", invited.user.id);
  return invited.user.id;
}
