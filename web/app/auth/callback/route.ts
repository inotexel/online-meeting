import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";

// Where Supabase sends the user after email confirmation, an invite, a password
// reset, or a Google sign-in. Exchanges the one-time code for a real session.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/account";

  // Only allow same-site redirects, so a crafted link can't bounce the user
  // off-site carrying a fresh session.
  const target = next.startsWith("/") ? next : "/account";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_code`);
  }

  return NextResponse.redirect(`${origin}${target}`);
}
