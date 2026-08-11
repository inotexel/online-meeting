import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserFromBearer, buildMe } from "@/lib/device-auth";

// The desktop app's single entitlement question: who am I, what may I use,
// and until when may that answer be trusted offline. Also the device heartbeat.

export async function GET(req: NextRequest) {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Heartbeat: lets the account page show which devices are actually in use.
  // Best-effort — a failed heartbeat must not block the entitlement answer.
  const machineId = req.headers.get("x-machine-id");
  if (machineId) {
    await supabaseAdmin()
      .from("devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("machine_id", machineId);
  }

  return NextResponse.json(await buildMe(user.id, user.email));
}
