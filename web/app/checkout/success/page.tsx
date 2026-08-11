import Link from "next/link";

// Buyers who started in the desktop app land here. They may have no password
// yet, so the instruction is "check your email", not "sign in".
export default function CheckoutSuccess() {
  return (
    <section className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re subscribed</h1>
      <p className="mt-3 text-mute">
        We emailed you a link to set your password. Your license key is on your account page —
        paste it into the desktop app to activate.
      </p>
      <Link
        href="/account"
        className="mt-8 inline-block rounded-lg bg-accent px-5 py-2.5 font-medium text-ink hover:opacity-90"
      >
        Go to my account
      </Link>
    </section>
  );
}
