import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { cx } from "../lib/cx";

export interface Toast {
  id: number;
  text: string;
  tone?: "neutral" | "good" | "bad" | "them";
  icon?: ReactNode;
}

const TONE: Record<string, string> = {
  neutral: "border-line-hi",
  good: "border-good/40",
  bad: "border-bad/40",
  them: "border-them/40",
};

export function Toaster({ items }: { items: Toast[] }) {
  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cx(
              "flex items-center gap-2 rounded-lg border bg-panel/95 px-3 py-2 text-13 text-ink-2 backdrop-blur",
              TONE[t.tone ?? "neutral"],
            )}
          >
            {t.icon}
            <span className="text-ink">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
