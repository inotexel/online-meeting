import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { consumeDeviceCode, mintSession, buildMe } from "@/lib/device-auth";

// Desktop app calls this after catching the pluely://auth deep link.
// code + verifier → Supabase session + entitlement snapshot, and the device
// gets registered in the same round-trip.

export async function POST(req: NextRequest) {
  let body: {
    code?: string;
    verifier?: string;
    machine_id?: string;
    app_version?: string;
    platform?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body" }, { status: 400 });
  }

  const { code, verifier, machine_id } = body;
  if (!code || !verifier || !machine_id) {
    return NextResponse.json(
      { error: "code, verifier and machine_id are required" },
      { status: 400 }
    );
  }

  // Atomic burn: wrong verifier, expired, or replayed all fail identically.
  const userId = await consumeDeviceCode(code, verifier);
  if (!userId) {
    return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: profile } = await db
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Account not found" }, { status: 401 });
  }

  const session = await mintSession(profile.email);

  const { error: deviceError } = await db.from("devices").upsert(
    {
      user_id: userId,
      machine_id,
      app_version: body.app_version ?? null,
      platform: body.platform ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "user_id,machine_id" }
  );
  if (deviceError) {
    return NextResponse.json(
      { error: `Could not register device: ${deviceError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? null,
    me: await buildMe(userId, profile.email),
  });
}
