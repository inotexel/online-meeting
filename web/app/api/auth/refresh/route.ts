import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Wraps Supabase's token refresh so the desktop app only ever talks to our
// domain and never needs to know the Supabase URL or anon key.

export async function POST(req: NextRequest) {
  let body: { refresh_token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  if (!body.refresh_token) {
    return NextResponse.json({ error: "refresh_token is required" }, { status: 400 });
  }

  const anon = createClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.refreshSession({
    refresh_token: body.refresh_token,
  });

  // 401 tells the app the session is dead (revoked, signed out elsewhere) and
  // it should drop to signed-out state — as opposed to a transient 5xx.
  if (error || !data.session) {
    return NextResponse.json({ error: "Session expired or revoked" }, { status: 401 });
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at ?? null,
  });
}
