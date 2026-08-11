"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { signUp, signInWithGoogle, type FormState } from "@/lib/actions";

const initial: FormState = { error: null };

function SignUpForm() {
  // Carried through the whole auth flow so the desktop hand-off
  // (/device-success?challenge=...) survives login/signup/OAuth.
  const next = useSearchParams().get("next") ?? "/account";
  const [state, action, pending] = useActionState(signUp, initial);

  return (
    <section className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-mute">
        Needed only for billing and your license key — the app itself works without one.
      </p>

      <form action={action} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label htmlFor="full_name" className="block text-sm text-mute">Name</label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
          />
        </div>
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
            minLength={8}
            autoComplete="new-password"
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 outline-none focus:border-accent"
          />
          <p className="mt-1 text-xs text-mute">At least 8 characters.</p>
        </div>

        {state.error && (
          <p role="alert" className="text-sm text-red-600">{state.error}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent py-2.5 font-medium text-ink hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Creating account…" : "Create account"}
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

      <p className="mt-6 text-sm text-mute">
        Already have an account?{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="hover:text-fg">Sign in</Link>
      </p>
    </section>
  );
}

export default function SignUp() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
