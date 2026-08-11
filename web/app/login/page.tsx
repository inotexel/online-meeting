"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, signInWithGoogle, type FormState } from "@/lib/actions";

const initial: FormState = { error: null };

function LoginForm() {
  // Carried through the whole auth flow so the desktop hand-off
  // (/device-success?challenge=...) survives login/signup/OAuth.
  const next = useSearchParams().get("next") ?? "/account";
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <section className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-mute">
        Your license key and billing live here. The desktop app doesn&apos;t need an account.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="email" className="block text-sm text-mute">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-mute">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
          />
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent py-2.5 font-medium text-ink hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <form action={signInWithGoogle} className="mt-3">
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="w-full rounded-lg border border-line py-2.5 font-medium hover:border-mute"
        >
          Continue with Google
        </button>
      </form>

      <div className="mt-6 flex justify-between text-sm text-mute">
        <Link href={`/signup?next=${encodeURIComponent(next)}`} className="hover:text-fg">Create an account</Link>
        <Link href="/login/reset" className="hover:text-fg">Forgot password?</Link>
      </div>
    </section>
  );
}

export default function Login() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
