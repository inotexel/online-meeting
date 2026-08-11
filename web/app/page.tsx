import Link from "next/link";
import { Reveal } from "@/components/Reveal";

/* Inline SVG icon set (Lucide outlines, 1.5px stroke) — consistent family, no
   emoji, no icon dependency for six glyphs. */
const Icon = {
  audio: (
    <path d="M12 2a4 4 0 0 0-4 4v6a4 4 0 0 0 8 0V6a4 4 0 0 0-4-4Zm7 10a7 7 0 0 1-14 0M12 19v3" />
  ),
  ghost: (
    <path d="M3 12a9 9 0 1 1 18 0v9l-2.5-2-2.5 2-3-2.5L10 21l-2.5-2L5 21v-9M9 11h.01M15 11h.01" />
  ),
  zap: <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />,
  doc: (
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5" />
  ),
  key: (
    <path d="M15 9a6 6 0 1 0-6 6m0 0 1.5-1.5M9 15l6.5 6.5L18 19l-2-2 2-2-2.5-2.5" />
  ),
  layers: (
    <path d="m12 2 9 5-9 5-9-5 9-5Zm-9 10 9 5 9-5M3 17l9 5 9-5" />
  ),
};

function FeatureIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-soft text-accent">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden
      >
        {children}
      </svg>
    </span>
  );
}

const FEATURES = [
  {
    icon: Icon.audio,
    title: "Hears the whole room",
    body: "Captures system audio and your microphone together — both sides of the call, transcribed live with speakers identified.",
  },
  {
    icon: Icon.ghost,
    title: "Invisible to screen shares",
    body: "The overlay is content-protected, so it stays out of shared screens and recordings on supported platforms.",
  },
  {
    icon: Icon.zap,
    title: "Answers before the pause ends",
    body: "One keystroke, answer inline. No window switching, no copy-paste, no tab hunting while everyone waits.",
  },
  {
    icon: Icon.doc,
    title: "Knows your documents",
    body: "Point it at your notes and specs. Answers are grounded in what you actually wrote, not just the model's guesses.",
  },
  {
    icon: Icon.key,
    title: "Bring your own model",
    body: "OpenAI, Anthropic, Gemini, or a local model. Your key, your provider, your bill — or use ours with Pro.",
  },
  {
    icon: Icon.layers,
    title: "Native everywhere",
    body: "Real native builds for macOS, Windows and Linux from one codebase — around 10MB, not a bundled browser.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Start your meeting",
    body: "Pluely sits as a slim bar above every window. Toggle listening with one shortcut — it transcribes both sides in real time.",
  },
  {
    n: "02",
    title: "Ask in place",
    body: "Hit the ask key and type — or just speak. Pluely already has the conversation and your documents as context.",
  },
  {
    n: "03",
    title: "Answer with confidence",
    body: "The response appears inline, invisible to screen shares. Press escape and it's gone without a trace.",
  },
];

const FAQS = [
  {
    q: "Is it really invisible on screen shares?",
    a: "The overlay window is flagged content-protected, which excludes it from capture on macOS and Windows. On Linux, behavior depends on your compositor — Wayland support varies by desktop environment.",
  },
  {
    q: "Do I need an account to use it?",
    a: "No. The app is open source and fully functional with your own API key, no account required. An account only exists for Pro billing and your license key.",
  },
  {
    q: "Where does my audio go?",
    a: "Transcripts and chat history live in a local SQLite database on your machine. With your own API key, audio goes only to your chosen provider — our servers handle billing and license checks, nothing else.",
  },
  {
    q: "Which platforms are supported?",
    a: "macOS (10.13+, Intel and Apple Silicon), Windows, and Linux (.deb, .rpm, AppImage). One license covers up to 3 machines.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes — from your account page via the Stripe billing portal, effective at the end of your billing period. The free BYO-key mode keeps working forever.",
  },
];

/** CSS-only mock of the desktop overlay — shows the product without a screenshot. */
function OverlayMock() {
  return (
    <div className="pointer-events-none mx-auto w-full max-w-2xl select-none">
      {/* the bar */}
      <div className="flex items-center gap-3 rounded-2xl border border-line bg-panel/80 px-4 py-3 shadow-xl shadow-fg/5 backdrop-blur-xl">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-fg text-[10px] font-bold text-panel">
          P
        </span>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 animate-pulse-dot" />
        <p className="truncate text-sm text-mute">
          Listening… <span className="text-fg">&ldquo;…walk me through the migration plan?&rdquo;</span>
        </p>
        <span className="ml-auto hidden shrink-0 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-mute sm:block">
          Ctrl + \
        </span>
      </div>
      {/* the answer card */}
      <div className="mx-4 mt-2 rounded-2xl border border-line bg-panel p-4 text-left shadow-2xl shadow-fg/10">
        <p className="text-xs font-medium uppercase tracking-wide text-accent">Suggested answer</p>
        <p className="mt-2 text-sm leading-relaxed text-fg">
          Phase one moves the audio pipeline behind the new capture API with a fallback flag;
          phase two migrates existing sessions in the background. Rollback is a config switch —
          no data migration required.
        </p>
        <p className="mt-3 border-t border-line pt-2 text-xs text-mute">
          Grounded in <span className="text-fg">migration-plan.md</span> · 2 sections cited
        </p>
      </div>
    </div>
  );
}

const WORKS_WITH = [
  "Zoom", "Google Meet", "Microsoft Teams", "Slack Huddles", "Webex",
  "Discord", "Around", "Jitsi", "Any browser call",
];

export default function Home() {
  return (
    <>
      {/* ------------------------------------------------------------ hero */}
      <section className="hero-glow relative overflow-hidden px-6 pb-20 pt-24 text-center sm:pt-32">
        {/* decorative blobs */}
        <div
          aria-hidden
          className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-accent/10 blur-3xl animate-float-slow"
        />
        <div
          aria-hidden
          className="absolute -right-24 top-40 h-80 w-80 rounded-full bg-sky-400/10 blur-3xl animate-float-slower"
        />

        <div className="relative mx-auto max-w-3xl">
          <Reveal>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-4 py-1.5 text-xs font-medium text-mute shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Open source · macOS · Windows · Linux
            </p>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="text-balance text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl">
              Every answer,
              <br />
              <span className="bg-gradient-to-r from-accent to-sky-500 bg-clip-text text-transparent">
                before you need it.
              </span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-mute">
              Pluely listens to your meetings and answers in place — a single bar above
              everything else, gone the moment you press escape.
            </p>
          </Reveal>
          <Reveal delay={240}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/pricing"
                className="rounded-full bg-fg px-7 py-3 font-medium text-panel shadow-lg shadow-fg/15 transition-transform duration-200 hover:scale-[1.04]"
              >
                Get Pluely free
              </Link>
              <Link
                href="/#how"
                className="rounded-full border border-line bg-panel px-7 py-3 font-medium transition-colors duration-200 hover:border-mute"
              >
                See how it works
              </Link>
            </div>
          </Reveal>
          <Reveal delay={340} className="mt-16">
            <OverlayMock />
          </Reveal>
        </div>
      </section>

      {/* --------------------------------------------------- works-with strip */}
      <section className="border-y border-line/60 bg-panel py-6" aria-label="Works with">
        <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
          <div className="flex w-max animate-marquee gap-12 whitespace-nowrap text-sm font-medium text-mute">
            {[...WORKS_WITH, ...WORKS_WITH].map((name, i) => (
              <span key={i} className="flex items-center gap-12">
                {name} <span className="text-line">·</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
        <Reveal>
          <p className="text-sm font-semibold uppercase tracking-widest text-accent">
            How it works
          </p>
          <h2 className="mt-3 max-w-xl text-4xl font-bold tracking-tight">
            From question to answer in one keystroke.
          </h2>
        </Reveal>
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 100}>
              <div className="group h-full rounded-2xl border border-line bg-panel p-7 transition-shadow duration-300 hover:shadow-lg hover:shadow-fg/5">
                <span className="text-sm font-bold text-accent">{step.n}</span>
                <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mute">{step.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- features */}
      <section id="features" className="border-y border-line/60 bg-panel py-24">
        <div className="mx-auto max-w-6xl scroll-mt-24 px-6">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">Features</p>
            <h2 className="mt-3 max-w-2xl text-4xl font-bold tracking-tight">
              Built for live conversations, not chat tabs.
            </h2>
            <p className="mt-4 max-w-2xl text-mute">
              Most assistants expect you to stop, switch windows and type out context. Pluely
              already has the context.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} delay={(i % 3) * 90}>
                <div className="h-full rounded-2xl border border-line bg-ink p-7 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-fg/5">
                  <FeatureIcon>{feature.icon}</FeatureIcon>
                  <h3 className="mt-5 font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-mute">{feature.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- privacy */}
      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">Privacy</p>
            <h2 className="mt-3 text-4xl font-bold tracking-tight">
              Your conversations never leave your machine.
            </h2>
            <p className="mt-4 leading-relaxed text-mute">
              Transcripts and chat history live in a local SQLite database. Bring your own API
              key and audio goes only to your chosen provider — our servers handle billing and
              license checks, nothing else. The entire client is open source, so you don&apos;t
              have to take our word for it.
            </p>
            <Link
              href="https://github.com/iamsrikanthnani/pluely"
              className="mt-6 inline-block text-sm font-medium text-accent hover:underline"
            >
              Read the source on GitHub →
            </Link>
          </Reveal>
          <Reveal delay={120}>
            <ul className="space-y-4">
              {[
                ["Local-first storage", "SQLite on disk — your history is a file you own, not a row in our database."],
                ["No account required", "The free app never asks who you are. Accounts exist only for Pro billing."],
                ["Open source client", "GPL-3.0. Audit it, fork it, build it yourself from the repo."],
              ].map(([title, body]) => (
                <li key={title} className="rounded-2xl border border-line bg-panel p-5">
                  <p className="font-semibold">{title}</p>
                  <p className="mt-1 text-sm text-mute">{body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* -------------------------------------------------------- platforms */}
      <section className="border-y border-line/60 bg-panel py-24">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <Reveal>
            <h2 className="text-4xl font-bold tracking-tight">Native on every desktop.</h2>
            <p className="mx-auto mt-4 max-w-xl text-mute">
              One ~10MB binary per platform. No Electron, no bundled browser — a Rust core with
              a native webview.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              ["macOS", "10.13+ · Intel & Apple Silicon", ".dmg"],
              ["Windows", "10 and 11", ".msi · .exe"],
              ["Linux", "PipeWire & PulseAudio", ".deb · .rpm · .AppImage"],
            ].map(([os, detail, formats], i) => (
              <Reveal key={os} delay={i * 90}>
                <div className="rounded-2xl border border-line bg-ink p-7">
                  <h3 className="text-lg font-semibold">{os}</h3>
                  <p className="mt-1 text-sm text-mute">{detail}</p>
                  <p className="mt-4 font-mono text-xs text-mute">{formats}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- FAQ */}
      <section className="mx-auto max-w-3xl px-6 py-24">
        <Reveal>
          <h2 className="text-center text-4xl font-bold tracking-tight">Questions, answered.</h2>
        </Reveal>
        <div className="mt-12 space-y-3">
          {FAQS.map((faq, i) => (
            <Reveal key={faq.q} delay={i * 60}>
              <details className="group rounded-2xl border border-line bg-panel px-6 py-4 open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="h-4 w-4 shrink-0 text-mute transition-transform duration-200 group-open:rotate-45"
                    aria-hidden
                  >
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-mute">{faq.a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- final CTA */}
      <section className="px-6 pb-24">
        <Reveal>
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-fg px-8 py-20 text-center text-panel">
            <div
              aria-hidden
              className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-accent/30 blur-3xl"
            />
            <div
              aria-hidden
              className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl"
            />
            <div className="relative">
              <h2 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
                Walk into your next meeting with backup.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-panel/70">
                Free forever with your own API key. Pro when you want the hosted model.
              </p>
              <Link
                href="/pricing"
                className="mt-9 inline-block rounded-full bg-panel px-8 py-3 font-medium text-fg transition-transform duration-200 hover:scale-[1.04]"
              >
                Get Pluely
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
