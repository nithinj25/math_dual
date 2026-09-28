import { useState } from "react";
import { motion } from "motion/react";
import { RotateCw } from "lucide-react";

import { TIERS, TIER_BANDS, board, standing, type Me, type Tier } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { ordinal, shortId, title } from "../lib/format";
import { Badge, Bar, Button, Card, CardHead, Empty, Segmented, Skeleton } from "../ui/primitives";
import { cx } from "../lib/cx";

const LIMITS = [10, 20, 50, 100];

/** Only the podium gets colour; everyone else is a plain numeral. */
const MEDAL: Record<number, string> = {
  1: "border-warn/40 bg-warn/10 text-warn",
  2: "border-line-hi bg-panel-hi text-ink-2",
  3: "border-them/30 bg-them/10 text-them",
};

export default function Leaderboard({ me }: { me: Me | null }) {
  const [tier, setTier] = useState<Tier>("intermediate");
  const [scope, setScope] = useState<"global" | "weekly">("global");
  const [limit, setLimit] = useState(20);
  const weekly = scope === "weekly";

  const data = usePolled(
    () =>
      Promise.all([
        board(tier, weekly, limit),
        me ? standing(tier, me.id, weekly) : Promise.resolve(null),
      ]),
    [tier, weekly, limit, me?.id],
  );

  const [rows, mine] = data.data ?? [null, null];
  const top = rows?.entries[0]?.points ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Leaderboard</h1>
          <p className="mt-1 max-w-[56ch] text-13 text-ink-2">
            Ladder points, not rating: a win is 3, a draw is 1, a loss is 0. Weekly
            boards reset with the ISO week.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={data.refresh} disabled={data.loading}>
          <RotateCw size={12} className={cx(data.loading && "animate-spin")} />
          {data.loading ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={tier}
          onChange={setTier}
          options={TIERS.map((t) => ({ value: t, label: title(t) }))}
        />
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "global", label: "All time" },
            { value: "weekly", label: "This week" },
          ]}
        />
        <span className="flex-1" />
        <Segmented
          value={String(limit)}
          onChange={(v) => setLimit(Number(v))}
          options={LIMITS.map((n) => ({ value: String(n), label: `top ${n}` }))}
        />
      </div>

      {mine && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent/30 bg-accent/[0.07] px-3 py-2.5 text-13 text-ink-2"
        >
          <span className="text-ink">
            You sit {ordinal(mine.rank)} of {mine.of}
          </span>
          <span className="text-line-hi">·</span>
          <span>
            {weekly ? "this week" : "all time"} in {tier}
          </span>
          <span className="text-line-hi">·</span>
          <span className="tnum text-ink">{Math.round(mine.points)} points</span>
        </motion.div>
      )}

      <Card className="overflow-hidden">
        <CardHead
          title={`${weekly ? "Weekly" : "All-time"} · ${title(tier)}`}
          right={<span className="font-mono text-11 text-ink-3">{TIER_BANDS[tier]}</span>}
        />

        {data.error && (
          <p className="border-b border-line bg-bad/10 px-4 py-2.5 text-13 text-bad">
            {data.error}
          </p>
        )}

        {data.loading && !rows && (
          <div className="flex flex-col gap-1.5 p-3">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className={cx("h-9", i > 3 && "opacity-60", i > 5 && "opacity-30")} />
            ))}
          </div>
        )}

        {rows && rows.entries.length === 0 && (
          <Empty
            title={`Nobody is on the ${weekly ? "weekly" : "all-time"} ${tier} board yet.`}
            hint="Play a match and you will be the first."
          />
        )}

        {rows && rows.entries.length > 0 && (
          <div>
            <div className="grid grid-cols-[3rem_1fr_9rem] gap-3 border-b border-line px-4 py-2">
              <span className="eyebrow">#</span>
              <span className="eyebrow">player</span>
              <span className="eyebrow text-right">points</span>
            </div>

            {rows.entries.map((r, i) => {
              const isMe = me?.id === r.user_id;
              return (
                <motion.div
                  key={r.user_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i, 12) * 0.015, duration: 0.25 }}
                  className={cx(
                    "grid grid-cols-[3rem_1fr_9rem] items-center gap-3 border-b border-line px-4 py-2 text-13 last:border-b-0",
                    isMe ? "bg-accent/[0.06]" : "hover:bg-panel-hi",
                  )}
                >
                  <span
                    className={cx(
                      "tnum grid h-6 w-6 place-items-center rounded-md border text-11 font-medium",
                      MEDAL[r.rank] ?? "border-transparent text-ink-3",
                    )}
                  >
                    {r.rank}
                  </span>

                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-mono text-11 text-ink-2">
                      {shortId(r.user_id)}
                    </span>
                    {isMe && <Badge tone="accent">you</Badge>}
                  </span>

                  <span className="flex items-center gap-2.5">
                    <Bar
                      value={top ? r.points / top : 0}
                      tone={isMe ? "accent" : "you"}
                      className="flex-1 opacity-70"
                    />
                    <span className="tnum w-8 text-right text-ink">
                      {Math.round(r.points)}
                    </span>
                  </span>
                </motion.div>
              );
            })}
          </div>
        )}
      </Card>

    </div>
  );
}
