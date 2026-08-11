"use client";

import { useActionState } from "react";
import { requestPasswordReset, type FormState } from "@/lib/actions";

const initial: FormState = { error: null };

export default function Reset() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);

  return (
    <section className="mx-auto max-w-sm px-6 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-mute">We&apos;ll email you a link to set a new one.</p>

      <form action={action} className="mt-8 space-y-4">
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
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-accent py-2.5 font-medium text-ink hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send reset link"}
        </button>
      </form>
    </section>
  );
}
