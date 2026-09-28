import { cx } from "../lib/cx";

/** The match clock. progress runs 1 -> 0 as the 120 seconds drain. */
export default function ClockRing({
  progress, label, low,
}: {
  progress: number;
  label: string;
  low?: boolean;
}) {
  const r = 21;
  const c = 2 * Math.PI * r;
  const k = Math.max(0, Math.min(1, progress));

  return (
    <div className="relative grid size-14 shrink-0 place-items-center">
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-line)" strokeWidth="2" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={low ? "var(--color-bad)" : "var(--color-ink-2)"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - k)}
          className="transition-[stroke-dashoffset,stroke] duration-1000 ease-linear"
        />
      </svg>
      <span className={cx("tnum text-13 font-medium", low ? "text-bad" : "text-ink-2")}>
        {label}
      </span>
    </div>
  );
}
