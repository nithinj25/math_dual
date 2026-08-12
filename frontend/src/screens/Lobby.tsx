import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight, Play } from "lucide-react";

import { TIERS, TIER_BANDS, type Me, type Tier, myRoom, queueSize, standing } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { ordinal } from "../lib/format";
import { Bar, Button, Card, CardHead, Kbd, Segmented, Skeleton } from "../ui/primitives";

/** The lobby answers two questions and nothing else: can I play right now, and
 *  where do I stand? Everything explanatory lives on the landing page. */
export default function Lobby({
  me, meError, onPlay, onOpenBoard,
}: {
  me: Me | null;
  meError: string | null;
  onPlay: () => void;
  onOpenBoard: () => void;
}) {
  const [scope, setScope] = useState<"global" | "weekly">("global");

  const queues = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 8000);
  const room = usePolled(() => (me ? myRoom(me.id) : Promise.resolve(null)), [me?.id], 15_000);
  const ranks = usePolled(
    () =>
      me
        ? Promise.all(TIERS.map((t) => standing(t, me.id, scope === "weekly")))
        : Promise.resolve<null[]>([]),
    [me?.id, scope],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLInputElement) && !e.metaKey) onPlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlay]);

  const total = queues.data?.reduce((n, q) => n + q.waiting, 0) ?? null;
  const busiest = Math.max(1, ...(queues.data?.map((q) => q.waiting) ?? [1]));
  const ranked = ranks.data?.filter(Boolean).length ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5 sm:py-8">
      {meError && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-13 text-warn">
          Signed in, but the server would not identify you: {meError}
        </p>
      )}

      {room.data && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-accent/30 bg-accent/[0.07] px-3 py-2.5 text-13"
        >
          <span className="text-ink">You have a match still running.</span>
          <span className="flex-1" />
          <Button size="sm" variant="primary" onClick={onPlay}>Rejoin</Button>
        </motion.div>
      )}

      {/* play */}
      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-[radial-gradient(24rem_10rem_at_50%_0%,rgba(110,121,232,0.18),transparent_72%)]" />
        <div className="relative flex flex-col items-start gap-4 p-5 sm:p-6">
          <div>
            <h2 className="text-xl sm:text-2xl">Ready when you are.</h2>
            <p className="mt-1 max-w-[46ch] text-13 text-ink-2">
              You are paired with the closest rating available, and the search widens
              every three seconds until someone turns up.
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-3">
            <Button size="lg" variant="primary" className="w-full sm:w-auto" onClick={onPlay}>
              <Play size={14} /> Find a match
            </Button>
            <span className="text-13 text-ink-3">
              <span className="hidden sm:inline">or press <Kbd>↵</Kbd></span>
              {total !== null && (
                <span className="sm:before:content-['_·_']">{total} waiting now</span>
              )}
            </span>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* where you stand */}
        <Card>
          <CardHead
            title="Your standing"
            right={
              <Segmented
                value={scope}
                onChange={setScope}
                options={[
                  { value: "global", label: "All time" },
                  { value: "weekly", label: "Week" },
                ]}
              />
            }
          />
          <div className="p-1.5">
            {ranks.loading && <Skeleton className="m-1.5 h-16" />}
            {!ranks.loading && ranked === 0 && (
              <p className="px-2.5 py-3 text-13 text-ink-3">
                No rank yet — one finished duel puts you on the board.
              </p>
            )}
            {ranks.data?.map((s, i) =>
              s ? (
                <div
                  key={TIERS[i]}
                  className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-13 hover:bg-panel-hi"
                >
                  <span className="capitalize text-ink-2">{TIERS[i]}</span>
                  <span className="text-ink">
                    {ordinal(s.rank)}
                    <span className="text-ink-3"> of {s.of} · {Math.round(s.points)} pts</span>
                  </span>
                </div>
              ) : null,
            )}
          </div>
          <div className="border-t border-line p-1.5">
            <Button variant="ghost" size="sm" className="w-full justify-between" onClick={onOpenBoard}>
              Open leaderboard <ArrowRight size={13} />
            </Button>
          </div>
        </Card>

        {/* who is around */}
        <Card>
          <CardHead title="Players waiting" right={<span className="text-11 text-ink-3">live</span>} />
          <div className="p-1.5">
            {TIERS.map((tier, i) => (
              <div key={tier} className="rounded-md px-2.5 py-2 hover:bg-panel-hi">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-13 capitalize text-ink">{tier}</span>
                  <span className="tnum text-13 text-ink-2">
                    {queues.data ? queues.data[i].waiting : "—"}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Bar
                    value={(queues.data?.[i].waiting ?? 0) / busiest}
                    tone={i === 2 ? "them" : "accent"}
                    className="flex-1"
                  />
                  <span className="font-mono text-11 text-ink-3">{TIER_BANDS[tier as Tier]}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
