import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

// Supabase access tokens are short-lived. Without a refresh on each request,
// Server Components would intermittently see a signed-in user as signed out.
export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Let requests through unauthenticated rather than 500ing the whole site if
  // env is missing — pages handle the signed-out case already.
  if (!url || !key) return res;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet: { name: string; value: string; options: CookieOptions }[]) => {
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of toSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must be getUser(), not getSession() — only getUser() revalidates the token
  // against the auth server.
  await supabase.auth.getUser();

  return res;
}

export const config = {
  // Skip static assets and the Stripe webhook (which carries no cookies and
  // must not have its body touched).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stripe).*)"],
};
