import { motion } from "motion/react";

import { TIERS, queueSize } from "../lib/api";
import { useNow, usePolled } from "../lib/hooks";
import type { Status } from "../lib/socket";
import { Button, Dot } from "../ui/primitives";

const MAX_WINDOW = 1000; // matchmaking/queue.py

export default function Queue({
  since, searchWindow, ws, onCancel,
}: {
  since: number;
  searchWindow: number | null;
  ws: Status;
  onCancel: () => void;
}) {
  const now = useNow(100);
  const elapsed = Math.max(0, now - since);
  const queues = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 5000);
  const waiting = queues.data?.reduce((n, q) => n + q.waiting, 0) ?? null;

  const width = searchWindow ?? 50;
  const r = 54;
  const c = 2 * Math.PI * r;

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-8 px-5 py-16 text-center">
      <div className="relative grid size-32 place-items-center">
        <svg viewBox="0 0 128 128" className="absolute inset-0 -rotate-90">
          <circle cx="64" cy="64" r={r} fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
          <circle
            cx="64" cy="64" r={r} fill="none"
            stroke="var(--color-accent)" strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(1, width / MAX_WINDOW))}
            className="transition-[stroke-dashoffset] duration-700 ease-out"
          />
        </svg>
        <motion.span
          className="absolute size-32 rounded-full border border-accent/20"
          animate={{ scale: [0.75, 1], opacity: [0.5, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
        />
        <span className="tnum text-2xl font-medium">{(elapsed / 1000).toFixed(1)}<span className="text-15 text-ink-3">s</span></span>
      </div>

      <div className="flex flex-col items-center gap-2">
        <h2 className="text-xl">Finding an opponent</h2>
        <p className="max-w-[42ch] text-13 text-ink-2">
          The search starts at ±50 rating and widens by 50 every three seconds. Speed
          beats precision here — an empty lobby is worse than an imperfect match.
        </p>
      </div>

      <div className="grid w-full grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
        <div className="bg-panel px-3 py-2.5">
          <div className="tnum text-15 text-ink">± {width}</div>
          <div className="eyebrow mt-0.5">rating window</div>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <div className="tnum text-15 text-ink">{waiting ?? "—"}</div>
          <div className="eyebrow mt-0.5">in queue</div>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <div className="flex items-center justify-center gap-1.5 text-15 text-ink">
            <Dot tone={ws === "open" ? "on" : ws === "connecting" ? "warn" : "off"} />
            <span className="text-13">{ws === "open" ? "linked" : ws}</span>
          </div>
          <div className="eyebrow mt-0.5">gateway</div>
        </div>
      </div>

      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  );
}
