import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase";
import { env } from "./env";

// Server side of the desktop sign-in flow (PKCE-style):
//   app keeps a secret `verifier`, sends sha256(verifier) as `challenge` →
//   browser signs in → /device-success mints a one-time code bound to that
//   challenge → deep link carries the code back → /api/auth/exchange demands
//   the verifier preimage. Intercepting the code without the verifier is useless.

const CODE_TTL_MS = 5 * 60 * 1000;
// How long the app may trust a cached "entitled" verdict while offline.
export const GRACE_HOURS = 72;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Mint a one-time device code for a signed-in user. */
export async function mintDeviceCode(userId: string, challenge: string): Promise<string> {
  const code = randomBytes(32).toString("hex");
  const { error } = await supabaseAdmin().from("device_codes").insert({
    code,
    user_id: userId,
    challenge,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`Could not mint device code: ${error.message}`);
  return code;
}

/**
 * Burn a device code and return its user id — atomic, so a replayed exchange
 * loses the race instead of minting a second session.
 */
export async function consumeDeviceCode(
  code: string,
  verifier: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("device_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", code)
    .eq("challenge", sha256Hex(verifier))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("user_id")
    .maybeSingle();

  if (error) throw new Error(`Device code exchange failed: ${error.message}`);
  return data?.user_id ?? null;
}

/**
 * Create a real Supabase session for a user, server-side, without sending any
 * email: generateLink() gives us the OTP hash, verifyOtp() redeems it.
 */
export async function mintSession(email: string) {
  const admin = supabaseAdmin();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !link) throw new Error(`generateLink failed: ${linkError?.message}`);

  const anon = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.verifyOtp({
    type: "email",
    token_hash: link.properties.hashed_token,
  });
  if (error || !data.session) throw new Error(`verifyOtp failed: ${error?.message}`);
  return data.session; // { access_token, refresh_token, expires_at, ... }
}

/** Validate a desktop JWT. Returns the user id + email, or null. */
export async function getUserFromBearer(header: string | null) {
  if (!header?.startsWith("Bearer ")) return null;
  const jwt = header.slice("Bearer ".length).trim();

  const anon = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.getUser(jwt);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

export type MePayload = {
  email: string;
  plan: "pro" | "free";
  entitled: boolean;
  /** ISO time until which the app may honor this verdict offline. */
  entitled_until: string | null;
};

/** The single answer to "who is this user and what may they use?". */
export async function buildMe(userId: string, email: string): Promise<MePayload> {
  const { data, error } = await supabaseAdmin().rpc("user_is_entitled", {
    p_user_id: userId,
  });
  if (error) throw new Error(`Entitlement check failed: ${error.message}`);
  const entitled = data === true;
  return {
    email,
    plan: entitled ? "pro" : "free",
    entitled,
    entitled_until: entitled
      ? new Date(Date.now() + GRACE_HOURS * 3600 * 1000).toISOString()
      : null,
  };
}
