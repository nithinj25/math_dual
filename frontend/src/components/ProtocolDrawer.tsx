import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import { clockTime } from "../lib/format";
import { Button } from "../ui/primitives";
import { cx } from "../lib/cx";

export interface LogEntry {
  id: string;
  kind: "in" | "out" | "rest" | "err";
  label: string;
  detail: string;
  at: number;
}

const TAG: Record<LogEntry["kind"], { text: string; className: string }> = {
  in: { text: "ws ◂", className: "text-accent-hi bg-accent/10" },
  out: { text: "ws ▸", className: "text-them bg-them/10" },
  rest: { text: "http", className: "text-ink-2 bg-panel-hi" },
  err: { text: "err", className: "text-bad bg-bad/10" },
};

/** The real protocol, live: every websocket frame and every HTTP call. */
export default function ProtocolDrawer({
  open, entries, onClose, onClear,
}: {
  open: boolean;
  entries: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(30rem,100vw)] flex-col border-l border-line-hi bg-bg"
          aria-label="Protocol log"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
            <span className="text-13 font-medium">Protocol</span>
            <span className="rounded-md bg-panel-hi px-1.5 text-11 text-ink-3">{entries.length}</span>
            <span className="flex-1" />
            <Button variant="ghost" size="sm" onClick={onClear}>Clear</Button>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close protocol log">
              <X size={14} />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 font-mono text-11 leading-relaxed">
            {entries.length === 0 && (
              <p className="p-4 text-ink-3">
                Nothing yet. Frames and HTTP calls appear here as they happen.
              </p>
            )}
            {entries.map((e) => (
              <div
                key={e.id}
                className="grid grid-cols-[4.6rem_2.4rem_1fr] gap-2 rounded px-1.5 py-1 hover:bg-panel"
              >
                <span className="text-ink-3">{clockTime(e.at)}</span>
                <span className={cx("h-4 rounded text-center text-[10px] leading-4", TAG[e.kind].className)}>
                  {TAG[e.kind].text}
                </span>
                <span className="text-ink-2">
                  <span className="text-ink">{e.label}</span> {e.detail}
                </span>
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
