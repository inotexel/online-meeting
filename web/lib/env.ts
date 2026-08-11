// Fail loudly at first use rather than silently sending `undefined` to Stripe or
// Supabase. Not validated at module load, because `next build` imports these
// modules without runtime env present.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  // Server-only. Bypasses RLS — never import this into a client component.
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  stripeSecretKey: () => required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: () => required("STRIPE_WEBHOOK_SECRET"),
  stripePriceId: () => required("STRIPE_PRICE_ID"),

  siteUrl: () => process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
};
