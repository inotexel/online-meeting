"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer, supabaseAdmin } from "./supabase";
import { stripe } from "./stripe";
import { env } from "./env";

// Server Actions for auth and billing. Every one of these runs on the server,
// so the anon key is the only Supabase credential the browser ever sees.

export type FormState = { error: string | null };

// Post-auth destination from a hidden `next` input. Same-site paths only, so a
// crafted login link can't bounce a fresh session to another origin.
function safeNext(formData: FormData, fallback = "/account"): string {
  const next = String(formData.get("next") ?? "");
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!email || !password) return { error: "Email and password are required." };
  // Supabase enforces its own minimum, but failing here gives a better message.
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const next = safeNext(formData);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName || null },
      // The confirmation email lands the user where they were headed —
      // for the desktop flow that's /device-success with its challenge.
      emailRedirectTo: `${env.siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error) return { error: error.message };
  redirect("/signup/check-email");
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  // Deliberately generic: distinguishing "no such user" from "wrong password"
  // would let anyone test whether an email has an account here.
  if (error) return { error: "Those credentials did not work." };

  revalidatePath("/", "layout");
  redirect(safeNext(formData));
}

// Bound directly to a <form action>, so it must resolve to void. Failures go
// back to /login as a query param — there is no return channel for a message.
export async function signInWithGoogle(formData: FormData): Promise<void> {
  const next = safeNext(formData);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${env.siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email address." };

  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${env.siteUrl()}/auth/callback?next=/account/password`,
  });
  // Always report success — otherwise this endpoint reveals who has an account.
  redirect("/login/check-email");
}

/** Start checkout for a signed-in user, binding the session to their customer. */
export async function startCheckout(): Promise<void> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const db = supabaseAdmin();
  const { data: profile } = await db
    .from("profiles")
    .select("stripe_customer_id, email")
    .eq("id", auth.user.id)
    .single();

  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe().customers.create({
      email: profile?.email ?? auth.user.email ?? undefined,
      metadata: { user_id: auth.user.id },
    });
    customerId = customer.id;
    await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", auth.user.id);
  }

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: env.stripePriceId(), quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${env.siteUrl()}/account?checkout=success`,
    cancel_url: `${env.siteUrl()}/pricing?canceled=1`,
    // Lets the webhook skip email matching entirely.
    metadata: { user_id: auth.user.id, source: "web" },
  });

  if (!session.url) redirect("/pricing?error=checkout");
  redirect(session.url);
}

/** Stripe-hosted portal for card changes, invoices, and cancellation. */
export async function openBillingPortal(): Promise<void> {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", auth.user.id)
    .single();

  if (!profile?.stripe_customer_id) redirect("/pricing?error=no_billing_account");

  const session = await stripe().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${env.siteUrl()}/account`,
  });

  redirect(session.url);
}

/** Sign a device out from the account page (removes its row; the device's
 *  session dies on its next refresh once we revoke, and it re-registers on
 *  next sign-in). Scoped to the caller's own devices. */
export async function removeDevice(_prev: FormState, formData: FormData): Promise<FormState> {
  const deviceId = String(formData.get("device_id") ?? "");
  if (!deviceId) return { error: "Missing device id." };

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { error } = await supabaseAdmin()
    .from("devices")
    .delete()
    .eq("id", deviceId)
    .eq("user_id", auth.user.id); // ownership check and delete in one statement

  if (error) return { error: `Could not remove device: ${error.message}` };
  revalidatePath("/account");
  return { error: null };
}
