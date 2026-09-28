import { motion } from "motion/react";
import { ArrowLeft, Swords } from "lucide-react";

import { TIERS, queueSize } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { Dot } from "../ui/primitives";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Google's mark, inline — the CSP-safe way to put it on the button. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.5-4.5 6.4l6.9 5.3c4.1-3.8 6.6-9.4 6.6-14.9z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 17 2 20.4 2 24s.9 7 2.4 10l7.1-5.5z" />
      <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 4.500 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
    </svg>
  );
}

export default function Login({
  onSignIn, onBack, busy, error,
}: {
  onSignIn: () => void;
  onBack: () => void;
  busy: boolean;
  error: string | null;
}) {
  const { data } = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 10_000);
  const waiting = data?.reduce((n, q) => n + q.waiting, 0) ?? null;

  return (
    <div className="flex flex-1 items-center justify-center px-5 py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="w-full max-w-sm"
      >
        <div className="card flex flex-col items-center gap-5 px-6 py-8 text-center sm:px-8">
          <span className="grid size-11 place-items-center rounded-xl bg-accent/15 text-accent-hi ring-1 ring-accent/25">
            <Swords size={20} strokeWidth={2.1} />
          </span>

          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl">Sign in to play</h1>
            <p className="text-13 leading-relaxed text-ink-2">
              One click with Google and you are in the queue. Nothing to install,
              nothing to configure.
            </p>
          </div>

          {/* Google's own button, not a themed one: the variant classes would
              fight the white surface over which colour wins. */}
          <button
            type="button"
            onClick={onSignIn}
            disabled={busy}
            className="inline-flex h-11 w-full select-none items-center justify-center gap-2.5 rounded-lg bg-white text-15 font-medium text-[#1f1f1f] transition-[background-color,opacity] duration-150 hover:bg-[#f1f1f1] active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
          >
            <GoogleMark />
            {busy ? "Opening Google…" : "Continue with Google"}
          </button>

          {error && (
            <p
              className="w-full rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-left text-13 text-bad"
              role="alert"
            >
              {error}
            </p>
          )}

          <span className="inline-flex h-6 items-center gap-2 rounded-full border border-line bg-panel px-2.5 text-11 text-ink-3">
            <Dot tone={waiting === null ? "idle" : "on"} />
            {waiting === null
              ? "checking the lobby"
              : `${waiting} player${waiting === 1 ? "" : "s"} in the queue`}
          </span>
        </div>

        <button
          onClick={onBack}
          className="mx-auto mt-4 flex items-center gap-1.5 text-13 text-ink-3 transition-colors hover:text-ink-2"
        >
          <ArrowLeft size={13} /> Back
        </button>
      </motion.div>
    </div>
  );
}
