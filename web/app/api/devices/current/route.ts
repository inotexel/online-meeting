import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUserFromBearer } from "@/lib/device-auth";

// Desktop sign-out: remove this machine's device row. Best-effort on the app
// side — a failure here never blocks local sign-out.

export async function DELETE(req: NextRequest) {
  const user = await getUserFromBearer(req.headers.get("authorization"));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const machineId = req.headers.get("x-machine-id");
  if (!machineId) {
    return NextResponse.json({ error: "x-machine-id header required" }, { status: 400 });
  }

  await supabaseAdmin()
    .from("devices")
    .delete()
    .eq("user_id", user.id)
    .eq("machine_id", machineId);

  return NextResponse.json({ removed: true });
}
