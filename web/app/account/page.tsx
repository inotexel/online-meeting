import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { openBillingPortal, startCheckout } from "@/lib/actions";
import { DeviceRow } from "./DeviceRow";

const ACTIVE = new Set(["active", "trialing", "past_due"]);

export default async function Account() {
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login?next=/account");

  const db = supabaseAdmin();

  const [{ data: profile }, { data: subscription }, { data: devices }] = await Promise.all([
    db.from("profiles").select("email, full_name").eq("id", auth.user.id).single(),
    db
      .from("subscriptions")
      .select("status, current_period_end, cancel_at_period_end")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("devices")
      .select("id, name, platform, app_version, last_seen_at")
      .eq("user_id", auth.user.id)
      .order("last_seen_at", { ascending: false }),
  ]);

  const isActive = subscription ? ACTIVE.has(subscription.status) : false;

  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-3xl font-bold tracking-tight">Account</h1>
      <p className="mt-2 text-mute">{profile?.email ?? auth.user.email}</p>

      {/* ---------------------------------------------------- subscription */}
      <div className="mt-10 rounded-2xl border border-line bg-panel p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold">Subscription</h2>
            <p className="mt-1 text-sm text-mute">
              {!subscription && "Free plan — bring your own API key in the app."}
              {subscription && (
                <>
                  {isActive ? "Pro · " : ""}
                  {subscription.status}
                  {subscription.current_period_end && (
                    <>
                      {" · "}
                      {subscription.cancel_at_period_end ? "ends" : "renews"}{" "}
                      {new Date(subscription.current_period_end).toLocaleDateString()}
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          <form action={subscription ? openBillingPortal : startCheckout}>
            <button
              type="submit"
              className="cursor-pointer rounded-full border border-line px-5 py-2 text-sm font-medium transition-colors hover:border-mute"
            >
              {subscription ? "Manage billing" : "Upgrade to Pro"}
            </button>
          </form>
        </div>
      </div>

      {/* ---------------------------------------------------------- devices */}
      <div className="mt-6 rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-semibold">Devices</h2>
        <p className="mt-1 text-sm text-mute">
          Machines signed in to your account. Signing in happens from the app — there&apos;s
          nothing to type here.
        </p>
        {devices && devices.length > 0 ? (
          <ul className="mt-4 divide-y divide-line">
            {devices.map((device) => (
              <DeviceRow
                key={device.id}
                id={device.id}
                name={device.name}
                platform={device.platform}
                appVersion={device.app_version}
                lastSeenAt={device.last_seen_at}
              />
            ))}
          </ul>
        ) : (
          <p className="mt-4 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mute">
            No devices yet. Open Pluely on your desktop and press &ldquo;Sign in&rdquo;.
          </p>
        )}
      </div>
    </section>
  );
}
