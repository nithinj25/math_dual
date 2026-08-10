/** The match clock. progress runs 1 -> 0 as the 120 seconds drain. */
export default function ClockRing({
  progress, label, low,
}: {
  progress: number;
  label: string;
  low?: boolean;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <div className="clock" title="time left in this match">
      <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
        <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="4" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={low ? "var(--bad)" : "var(--me)"}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: "stroke-dashoffset .3s linear, stroke .3s" }}
        />
      </svg>
      <span className={`t ${low ? "low" : ""}`}>{label}</span>
    </div>
  );
}
