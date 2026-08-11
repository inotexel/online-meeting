import type { Metadata } from "next";
import Link from "next/link";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { supabaseServer } from "@/lib/supabase";
import { signOut } from "@/lib/actions";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pluely — the AI assistant for live conversations",
  description:
    "A lightning-fast, privacy-first AI assistant that works during meetings and interviews. Runs on macOS, Windows and Linux.",
};

async function Nav() {
  // Reading the session here keeps the header honest on every route without a
  // client-side flash of the wrong state.
  let signedIn = false;
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    // Env not configured (e.g. during `next build`). Render the public header.
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line/60 bg-panel/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-fg text-xs font-bold text-panel">
            P
          </span>
          Pluely
        </Link>
        <div className="flex items-center gap-6 text-sm text-mute">
          <Link href="/#features" className="hidden hover:text-fg sm:block">Features</Link>
          <Link href="/#how" className="hidden hover:text-fg sm:block">How it works</Link>
          <Link href="/pricing" className="hover:text-fg">Pricing</Link>
          {signedIn ? (
            <>
              <Link href="/account" className="hover:text-fg">Account</Link>
              <form action={signOut}>
                <button type="submit" className="cursor-pointer hover:text-fg">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="hover:text-fg">Sign in</Link>
              <Link
                href="/pricing"
                className="rounded-full bg-fg px-4 py-1.5 font-medium text-panel transition-transform duration-200 hover:scale-[1.03]"
              >
                Get Pluely
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="min-h-dvh font-sans">
        <Nav />
        <main>{children}</main>
        <footer className="mt-24 border-t border-line/60 px-6 py-12 text-sm text-mute">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-fg">Pluely</p>
              <p className="mt-1">© {new Date().getFullYear()} · Open source, GPL-3.0.</p>
            </div>
            <div className="flex gap-6">
              <Link href="/#features" className="hover:text-fg">Features</Link>
              <Link href="/pricing" className="hover:text-fg">Pricing</Link>
              <Link href="/login" className="hover:text-fg">Sign in</Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
