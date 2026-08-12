import { motion } from "motion/react";
import { ArrowRight, Home, RotateCw } from "lucide-react";

import { standing, type Me, type Tier } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { TOTAL_QUESTIONS, accuracy, type DuelState } from "../lib/duel";
import { ordinal, secs, shortId } from "../lib/format";
import type { ServerMsg } from "../lib/socket";
import { Button, Card, CardHead, Stat } from "../ui/primitives";
import { cx } from "../lib/cx";
import { Ticker } from "../ui/Ticker";

type End = Extract<ServerMsg, { t: "end" }>;

const EASE = [0.22, 1, 0.36, 1] as const;

const VERDICT: Record<End["winner"], { text: string; className: string }> = {
  you: { text: "You won", className: "text-good" },
  them: { text: "You lost", className: "text-them" },
  draw: { text: "Draw", className: "text-ink-2" },
};

/** Solve times as a bar per question — where the match was actually won. */
function Pace({ duel }: { duel: DuelState }) {
  const solves = duel.solveMs.slice(0, TOTAL_QUESTIONS);
  const worst = Math.max(1, ...solves.filter((n) => n > 0));

  return (
    <div className="flex h-16 items-end gap-[3px] px-4 py-3">
      {Array.from({ length: TOTAL_QUESTIONS }, (_, i) => {
        const ms = solves[i] ?? 0;
        const outcome = duel.outcomes[i];
        return (
          <motion.div
            key={i}
            initial={{ height: 0 }}
            animate={{ height: `${ms ? Math.max(6, (ms / worst) * 100) : 4}%` }}
            transition={{ delay: 0.2 + i * 0.02, duration: 0.4, ease: EASE }}
            title={ms ? `q${i + 1} · ${secs(ms)}` : `q${i + 1} · unanswered`}
            className={cx(
              "flex-1 rounded-sm",
              outcome === "hit" ? "bg-good/70" : outcome === "miss" ? "bg-bad/60" : "bg-line",
            )}
          />
        );
      })}
    </div>
  );
}

export default function Result({
  end, duel, me, onAgain, onHome, onBoard,
}: {
  end: End;
  duel: DuelState;
  me: Me | null;
  onAgain: () => void;
  onHome: () => void;
  onBoard: () => void;
}) {
  const [mine, theirs] = end.score;
  const verdict = VERDICT[end.winner];
  const delta = end.ratingDelta;

  // The board is updated as part of finalisation, so this can land a moment
  // late. Polling briefly is honest about that instead of showing a stale rank.
  const tier = (duel.tier || "intermediate") as Tier;
  const rank = usePolled(
    () => (me ? standing(tier, me.id) : Promise.resolve(null)),
    [me?.id, tier],
    5000,
  );

  const solves = duel.solveMs.filter((n) => n > 0);
  const fastest = solves.length ? Math.min(...solves) : 0;
  const average = solves.length ? solves.reduce((a, b) => a + b, 0) / solves.length : 0;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
      >
        <Card className="overflow-hidden">
          <div className="relative flex flex-col items-center gap-4 px-6 pb-6 pt-8 text-center">
            {/* The glow is anchored to the card's top edge, so the only hard
                cut in the gradient box lands on the border and stays unseen. */}
            <div
              className={cx(
                "pointer-events-none absolute inset-x-0 top-0 h-40",
                end.winner === "you"
                  ? "bg-[radial-gradient(22rem_9rem_at_50%_0%,rgba(76,183,130,0.20),transparent_72%)]"
                  : end.winner === "them"
                    ? "bg-[radial-gradient(22rem_9rem_at_50%_0%,rgba(229,115,90,0.18),transparent_72%)]"
                    : "bg-[radial-gradient(22rem_9rem_at_50%_0%,rgba(110,121,232,0.16),transparent_72%)]",
              )}
            />

            <span className="eyebrow relative">{duel.tier || "duel"} · final</span>
            <h1 className={cx("relative text-3xl", verdict.className)}>{verdict.text}</h1>

            <div className="relative flex items-center gap-5">
              <Ticker value={mine} className="text-5xl font-medium text-you" />
              <span className="text-13 text-ink-3">vs</span>
              <Ticker value={theirs} className="text-5xl font-medium text-them" />
            </div>

            <p className="relative text-13 text-ink-2">
              against {duel.opponent || "your opponent"}
            </p>

            {/* Scale only, never opacity: the rating change is the point of
                this screen, so it must be legible even if nothing animates. */}
            <motion.div
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.25, duration: 0.35, ease: EASE }}
              className={cx(
                "tnum relative rounded-lg border px-3 py-1.5 text-15 font-medium",
                delta > 0
                  ? "border-good/30 bg-good/10 text-good"
                  : delta < 0
                    ? "border-bad/30 bg-bad/10 text-bad"
                    : "border-line-hi text-ink-2",
              )}
            >
              {delta > 0 ? "+" : ""}{delta} rating
            </motion.div>

            <p className="relative max-w-[46ch] text-13 text-ink-3">
              {Math.abs(delta) > 100
                ? "A big move — Glicko-2 is still unsure how good you are, so it trusts this result heavily."
                : "A small move — your rating deviation has settled, so each result nudges rather than shoves."}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
            <Stat label="correct" value={`${duel.yourScore}/${duel.answered || 0}`} />
            <Stat label="accuracy" value={`${Math.round(accuracy(duel) * 100)}%`} />
            <Stat label="fastest" value={fastest ? secs(fastest) : "—"} />
            <Stat label="average" value={average ? secs(average) : "—"} />
          </div>
        </Card>
      </motion.div>

      <Card>
        <CardHead
          title="Your pace"
          right={<span className="text-11 text-ink-3">per question, slowest is tallest</span>}
        />
        <Pace duel={duel} />
      </Card>

      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-4 py-2.5 text-13 text-ink-2">
        {rank.loading && <span className="text-ink-3">updating your position…</span>}
        {!rank.loading && rank.data && (
          <span>
            You are now{" "}
            <span className="text-ink">{ordinal(rank.data.rank)} of {rank.data.of}</span> in{" "}
            {tier} with{" "}
            <span className="tnum text-ink">{Math.round(rank.data.points)}</span> ladder points.
          </span>
        )}
        {!rank.loading && !rank.data && <span>You are not on this board yet.</span>}
        <span className="flex-1" />
        <span className="hidden font-mono text-11 text-ink-3 sm:inline">
          {duel.matchId ? shortId(duel.matchId) : "—"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="lg" variant="primary" onClick={onAgain}>
          <RotateCw size={14} /> Play again
        </Button>
        <Button size="lg" onClick={onBoard}>
          Leaderboard <ArrowRight size={14} />
        </Button>
        <Button size="lg" variant="ghost" onClick={onHome}>
          <Home size={14} /> Home
        </Button>
      </div>
    </div>
  );
}
