import { motion } from "motion/react";
import { ArrowRight, Database, Radio, Server, Swords, Timer, Workflow } from "lucide-react";

import { TIERS, queueSize } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { cx } from "../lib/cx";
import { Button, Dot } from "../ui/primitives";

const EASE = [0.22, 1, 0.36, 1] as const;

const FAIR = [
  {
    k: "One seed, two players",
    v: "A single seed generates both question sets, so you and your opponent answer the same twenty in the same order.",
  },
  {
    k: "Timed on the server",
    v: "Solve time is measured where the question was served, minus half your round trip — a fast connection is not a faster brain.",
  },
  {
    k: "Rated with Glicko-2",
    v: "Every result moves your rating and the uncertainty around it, so a new player converges in a handful of matches.",
  },
];

const STEPS = [
  "Join the queue for your tier; the search starts at ±50 rating.",
  "It widens by 50 every three seconds until someone turns up.",
  "Both clients get matched, then a three second countdown.",
  "Twenty questions, served one at a time, two minutes on the clock.",
  "More correct wins; a tie breaks on total solve time.",
  "Glicko-2 rates it and ladder points land on the board: 3 / 1 / 0.",
];

const STACK = [
  { icon: Server, k: "FastAPI", v: "auth, questions, ratings, leaderboards" },
  { icon: Radio, k: "Redis", v: "one sorted set per tier, paired by an atomic Lua call" },
  { icon: Workflow, k: "WebSocket gateway", v: "stateless — a match survives losing a process" },
  { icon: Database, k: "Postgres", v: "users, matches and the rated history behind the board" },
  { icon: Timer, k: "Server clocks", v: "every deadline belongs to the server, never the tab" },
  { icon: Swords, k: "Kafka", v: "an event per answer, for analytics after the fact" },
];

/** A still of the duel screen — what the visitor is signing in to see. */
function Preview() {
  const dots = ["hit", "hit", "hit", "miss", "hit", "hit", "hit", "hit", "miss", "now"];
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-11 text-ink-3">you</div>
          <div className="tnum text-2xl font-medium text-you">11</div>
        </div>
        <div className="grid size-12 shrink-0 place-items-center rounded-full border border-line">
          <span className="tnum text-13 text-ink-2">0:54</span>
        </div>
        <div className="min-w-0 flex-1 text-right">
          <div className="truncate text-11 text-ink-3">kepler</div>
          <div className="tnum text-2xl font-medium text-them">9</div>
        </div>
      </div>

      <div className="flex gap-[3px] px-4">
        {dots.map((d, i) => (
          <span
            key={i}
            className={cx(
              "h-1 flex-1 rounded-full",
              d === "hit" ? "bg-good" : d === "miss" ? "bg-bad/60" : "bg-accent",
            )}
          />
        ))}
      </div>

      {/* .grid-fade carries a mask, which would fade this card's contents too,
          so it stays on a layer of its own behind them. */}
      <div className="relative mt-2 h-40" aria-hidden="true">
        <div className="grid-fade absolute inset-0" />
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex flex-col items-center gap-3">
            <span className="tnum text-11 text-ink-3">question 15 of 20</span>
            <span className="tnum text-4xl font-medium tracking-[-0.04em]">
              47 <span className="text-ink-3">×</span> 6
            </span>
            <span className="grid h-9 w-40 place-items-center rounded-lg border border-line-hi bg-panel text-13 text-ink-3">
              answer
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing({
  onStart, signedIn,
}: {
  /** Sends the visitor on: to the sign-in page, or straight in if they are
   *  already signed in. Signing in itself happens on the next page. */
  onStart: () => void;
  signedIn: boolean;
}) {
  const { data } = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 10_000);
  const waiting = data?.reduce((n, q) => n + q.waiting, 0) ?? null;

  const cta = (
    <Button size="lg" variant="primary" onClick={onStart}>
      {signedIn ? "Play a duel" : "Sign in to play"}
      <ArrowRight size={14} />
    </Button>
  );

  return (
    <div className="flex flex-1 flex-col">
      {/* hero */}
      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 items-center gap-10 px-5 py-16 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-14 lg:py-24">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex flex-col items-start gap-5"
        >
          <span className="inline-flex h-6 items-center gap-2 rounded-full border border-line bg-panel px-2.5 text-11 text-ink-2">
            <Dot tone={waiting === null ? "idle" : "on"} />
            {waiting === null
              ? "checking the lobby"
              : `${waiting} player${waiting === 1 ? "" : "s"} in the queue`}
          </span>

          <h1 className="max-w-[15ch] bg-gradient-to-b from-ink to-[#a9aeb8] bg-clip-text text-[clamp(2.5rem,6.5vw,3.75rem)] leading-[1.03] tracking-[-0.035em] text-transparent">
            Mental arithmetic, as a duel.
          </h1>

          <p className="max-w-[48ch] text-15 leading-relaxed text-ink-2">
            Two players, twenty questions, two minutes. The same twenty in the same
            order — so the only variable is how fast you think.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {cta}
            <span className="text-13 text-ink-3">Free · one click with Google</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
        >
          <Preview />
        </motion.div>
      </section>

      {/* what makes it fair */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-16">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {FAIR.map((f) => (
            <div key={f.k} className="bg-panel p-5">
              <div className="text-13 font-medium text-ink">{f.k}</div>
              <p className="mt-1.5 text-13 leading-relaxed text-ink-3">{f.v}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how a duel runs */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-16">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-xl">How a duel runs</h2>
          <span className="text-13 text-ink-3">start to rated result</span>
        </div>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className="flex items-start gap-3 rounded-lg border border-line bg-panel px-4 py-3 text-13 text-ink-2"
            >
              <span className="mt-px grid size-5 shrink-0 place-items-center rounded border border-line bg-panel-hi font-mono text-11 text-ink-3">
                {i + 1}
              </span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* under the hood */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-16">
        <div className="mb-5 flex items-baseline justify-between gap-4">
          <h2 className="text-xl">Under the hood</h2>
          <span className="text-13 text-ink-3">what runs a match</span>
        </div>
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {STACK.map(({ icon: Icon, k, v }) => (
            <div key={k} className="flex gap-3 bg-panel p-4">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-line bg-panel-hi text-ink-3">
                <Icon size={13} />
              </span>
              <div className="min-w-0">
                <div className="text-13 font-medium text-ink">{k}</div>
                <p className="mt-0.5 text-13 leading-relaxed text-ink-3">{v}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* closing */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-20">
        <div className="card relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(26rem_10rem_at_50%_0%,rgba(110,121,232,0.18),transparent_72%)]" />
          <div className="relative flex flex-col items-center gap-4 px-6 py-12 text-center">
            <h2 className="text-2xl">Find out how fast you actually are.</h2>
            <p className="max-w-[44ch] text-13 text-ink-2">
              One click with Google and you are in the queue. Nothing to install,
              nothing to configure.
            </p>
            {cta}
          </div>
        </div>

        <p className="mt-6 text-center text-11 text-ink-3">
          MathDuel · built as a system-design project — matchmaking, real-time play
          and rating, end to end.
        </p>
      </section>
    </div>
  );
}
