import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase";
import { mintDeviceCode } from "@/lib/device-auth";

// Landing point of the desktop sign-in flow. The app opened the browser at
// /login?next=/device-success?challenge=<sha256(verifier)>; by the time we're
// here the user has a web session. Mint the one-time code and bounce to the
// pluely:// deep link, which the OS routes to the app.

export default async function DeviceSuccess({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string }>;
}) {
  const { challenge } = await searchParams;

  // sha256 hex, nothing else. A malformed challenge means a hand-built URL.
  if (!challenge || !/^[0-9a-f]{64}$/.test(challenge)) redirect("/login");

  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    redirect(`/login?next=${encodeURIComponent(`/device-success?challenge=${challenge}`)}`);
  }

  const code = await mintDeviceCode(auth.user.id, challenge);
  const deepLink = `pluely://auth?code=${code}`;

  return (
    <>
      {/* Auto-open the app. A meta refresh survives strict popup blockers. */}
      <meta httpEquiv="refresh" content={`0;url=${deepLink}`} />
      <section className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Opening Pluely…</h1>
        <p className="mt-3 text-mute">
          Your browser should hand you back to the app. If nothing happens:
        </p>
        <a
          href={deepLink}
          className="mt-8 inline-block rounded-full bg-fg px-7 py-3 font-medium text-panel transition-transform duration-200 hover:scale-[1.03]"
        >
          Open Pluely
        </a>
        <p className="mt-6 text-xs text-mute">
          This link works once and expires in 5 minutes. You can close this tab afterwards.
        </p>
      </section>
    </>
  );
}
