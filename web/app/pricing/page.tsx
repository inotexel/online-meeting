import Link from "next/link";
import { supabaseServer } from "@/lib/supabase";
import { startCheckout } from "@/lib/actions";
import { Reveal } from "@/components/Reveal";

const FREE = [
  "Full desktop app, all platforms",
  "Bring your own API key",
  "System audio + mic capture",
  "Local transcript history",
];

const PRO = [
  "Everything in Free",
  "Hosted model — no API key needed",
  "Document-grounded answers",
  "Up to 3 machines per license",
  "Priority updates and support",
];

function Check() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default async function Pricing() {
  let signedIn = false;
  try {
    const supabase = await supabaseServer();
    const { data } = await supabase.auth.getUser();
    signedIn = Boolean(data.user);
  } catch {
    // Env not configured at build time; render as signed out.
  }

  return (
    <section className="hero-glow px-6 py-24">
      <div className="mx-auto max-w-5xl">
        <Reveal>
          <div className="text-center">
            <h1 className="text-5xl font-bold tracking-tight">Simple pricing</h1>
            <p className="mx-auto mt-4 max-w-xl text-mute">
              The app is open source and free forever with your own key. Pay only for the
              hosted model.
            </p>
          </div>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <Reveal delay={80}>
            <div className="h-full rounded-3xl border border-line bg-panel p-8">
              <h2 className="text-lg font-semibold">Free</h2>
              <p className="mt-3 text-5xl font-bold tracking-tight">$0</p>
              <p className="mt-1 text-sm text-mute">Bring your own API key</p>
              <ul className="mt-8 space-y-3 text-sm text-mute">
                {FREE.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Check />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="https://github.com/iamsrikanthnani/pluely/releases"
                className="mt-10 block rounded-full border border-line py-3 text-center font-medium transition-colors duration-200 hover:border-mute"
              >
                Download
              </a>
            </div>
          </Reveal>

          <Reveal delay={160}>
            <div className="relative h-full rounded-3xl border-2 border-fg bg-panel p-8 shadow-xl shadow-fg/10">
              <span className="absolute -top-3 right-8 rounded-full bg-fg px-3 py-1 text-xs font-semibold text-panel">
                Most popular
              </span>
              <h2 className="text-lg font-semibold">Pro</h2>
              {/* Price is display-only. Stripe's Price object is the real number. */}
              <p className="mt-3 text-5xl font-bold tracking-tight">
                $12
                <span className="text-base font-normal text-mute"> / month</span>
              </p>
              <p className="mt-1 text-sm text-mute">Hosted model included</p>
              <ul className="mt-8 space-y-3 text-sm text-mute">
                {PRO.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <Check />
                    {item}
                  </li>
                ))}
              </ul>

              {signedIn ? (
                <form action={startCheckout} className="mt-10">
                  <button
                    type="submit"
                    className="w-full cursor-pointer rounded-full bg-fg py-3 font-medium text-panel transition-transform duration-200 hover:scale-[1.02]"
                  >
                    Subscribe
                  </button>
                </form>
              ) : (
                <Link
                  href="/signup?next=/pricing"
                  className="mt-10 block rounded-full bg-fg py-3 text-center font-medium text-panel transition-transform duration-200 hover:scale-[1.02]"
                >
                  Create an account
                </Link>
              )}
              <p className="mt-3 text-center text-xs text-mute">
                Cancel any time from your account page.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
