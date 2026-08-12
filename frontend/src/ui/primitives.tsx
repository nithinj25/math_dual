import type {
  ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode,
} from "react";

import { cx } from "../lib/cx";

/* --- button --------------------------------------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-white hover:bg-accent-hi shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
  secondary:
    "bg-panel-hi text-ink border border-line-hi hover:bg-[#1c1f23] hover:border-[#33373d]",
  ghost: "text-ink-2 hover:text-ink hover:bg-panel-hi",
  danger: "text-bad hover:bg-bad/10 border border-bad/25",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-13 gap-1.5 rounded-md",
  md: "h-8 px-3 text-13 gap-2 rounded-md",
  lg: "h-10 px-5 text-15 gap-2 rounded-lg",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cx(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium",
        "transition-[background-color,border-color,color,opacity,transform] duration-150",
        "active:translate-y-px disabled:pointer-events-none disabled:opacity-40",
        VARIANT[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/* --- surfaces ------------------------------------------------------------- */

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHead({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex h-11 items-center justify-between gap-3 border-b border-line px-4">
      <h3 className="text-13 font-medium text-ink">{title}</h3>
      {right}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-8 min-w-0 rounded-md border border-line bg-panel-hi px-2.5 text-13 text-ink outline-none",
        "transition-[border-color,box-shadow] duration-150 placeholder:text-ink-3",
        "focus:border-accent focus:shadow-[0_0_0_3px_rgba(110,121,232,0.16)]",
        className,
      )}
      {...rest}
    />
  );
}

/* --- small pieces --------------------------------------------------------- */

const TONE: Record<string, string> = {
  neutral: "border-line-hi text-ink-2",
  accent: "border-accent/30 text-accent-hi bg-accent/10",
  good: "border-good/30 text-good bg-good/10",
  bad: "border-bad/30 text-bad bg-bad/10",
  warn: "border-warn/30 text-warn bg-warn/10",
  them: "border-them/30 text-them bg-them/10",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof TONE | string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-11 font-medium",
        TONE[tone] ?? TONE.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "off" }: { tone?: "on" | "warn" | "off" | "idle" }) {
  const color =
    tone === "on" ? "bg-good" : tone === "warn" ? "bg-warn" : tone === "off" ? "bg-bad" : "bg-ink-3";
  return (
    <span className="relative inline-flex size-1.5 shrink-0">
      <span className={cx("size-1.5 rounded-full", color)} />
      {tone === "on" && (
        <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", color)} />
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-hi bg-panel-hi px-1.5 font-mono text-11 text-ink-2">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx(
        "animate-pulse rounded-md bg-gradient-to-r from-panel-hi via-[#212429] to-panel-hi",
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  value, options, onChange, className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "inline-flex h-8 items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cx(
            "h-7 rounded-md px-2.5 text-13 font-medium transition-colors duration-150",
            // A background lift alone is nearly invisible at these values, so
            // the selected segment also gets a hairline and full-strength ink.
            value === o.value
              ? "bg-[#22262b] text-ink ring-1 ring-line-hi shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
              : "text-ink-3 hover:text-ink-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A thin two-tone bar. Everything progress-shaped in the app uses it. */
export function Bar({
  value, tone = "accent", className,
}: {
  value: number;
  tone?: "accent" | "you" | "them" | "good";
  className?: string;
}) {
  const fill =
    tone === "you" ? "bg-you" : tone === "them" ? "bg-them" : tone === "good" ? "bg-good" : "bg-accent";
  return (
    <div className={cx("h-1 w-full overflow-hidden rounded-full bg-line", className)}>
      <div
        className={cx("h-full rounded-full transition-[width] duration-500", fill)}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

/** One cell of a stat strip. Carries no border of its own: strips are built as
 *  a `gap-px bg-line` grid, so the hairlines come from the gaps. */
export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="tnum text-lg font-medium text-ink">{value}</div>
      <div className="eyebrow mt-0.5">{label}</div>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
      <p className="text-13 text-ink-2">{title}</p>
      {hint && <p className="text-13 text-ink-3">{hint}</p>}
    </div>
  );
}
