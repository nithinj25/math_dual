import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Flame } from "lucide-react";

import ClockRing from "../components/ClockRing";
import Keypad from "../components/Keypad";
import { MATCH_MS, TOTAL_QUESTIONS, streak, type DuelState, type Phase } from "../lib/duel";
import { mmss, secs } from "../lib/format";
import { useNow } from "../lib/hooks";
import type { Status } from "../lib/socket";
import { Button } from "../ui/primitives";
import { cx } from "../lib/cx";
import { Ticker } from "../ui/Ticker";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Dim everything that is not a digit, so the operands read first. */
function Prompt({ text }: { text: string }) {
  const parts = text.split(/(\d+)/).filter(Boolean);
  return (
    <span>
      {parts.map((p, i) =>
        /^\d+$/.test(p) ? (
          <span key={i}>{p}</span>
        ) : (
          <span key={i} className="text-ink-3">{p}</span>
        ),
      )}
    </span>
  );
}

function Dots({ states }: { states: string[] }) {
  return (
    <div className="flex flex-1 gap-[3px]">
      {states.map((s, i) => (
        <span
          key={i}
          className={cx(
            "h-1 flex-1 rounded-full transition-colors duration-300",
            s === "hit" && "bg-good",
            s === "miss" && "bg-bad/60",
            s === "now" && "bg-accent",
            s === "opp" && "bg-them/70",
            s === "" && "bg-line",
          )}
        />
      ))}
    </div>
  );
}

export default function Duel({
  state, phase, status, meName, onAnswer, onLeave,
}: {
  state: DuelState;
  phase: Phase;
  status: Status;
  meName: string;
  onAnswer: (value: number) => void;
  onLeave: () => void;
}) {
  const [text, setText] = useState("");
  const [flash, setFlash] = useState<{ correct: boolean; at: number } | null>(null);
  const [keypad, setKeypad] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
  );
  const input = useRef<HTMLInputElement>(null);
  const now = useNow(100, phase === "countdown" || phase === "live");

  useEffect(() => {
    setText("");
    input.current?.focus();
  }, [state.qIndex]);

  useEffect(() => {
    if (!state.last) return;
    setFlash({ correct: state.last.correct, at: state.last.at });
    const id = setTimeout(() => setFlash(null), 1000);
    return () => clearTimeout(id);
  }, [state.last]);

  const done = state.answered >= TOTAL_QUESTIONS;
  const locked = status !== "open" || phase !== "live" || done;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const raw = text.trim();
    if (raw === "" || locked) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    onAnswer(value);
    setText("");
    input.current?.focus();
  }

  function key(k: string) {
    if (k === "back") return setText((t) => t.slice(0, -1));
    if (k === "-") return setText((t) => (t.startsWith("-") ? t.slice(1) : `-${t}`));
    setText((t) => (t.length < 10 ? t + k : t));
  }

  const remaining = state.liveAt === null ? null : state.liveAt + MATCH_MS - now;
  const countdownLeft = state.liveAt === null ? 0 : state.liveAt - now;
  const solving = state.shownAt ? now - state.shownAt : 0;
  const run = streak(state);
  const share = (state.yourScore + 1) / (state.yourScore + state.oppScore + 2);

  const mine = useMemo(
    () =>
      Array.from({ length: TOTAL_QUESTIONS }, (_, i) => {
        const o = state.outcomes[i];
        if (o === "hit") return "hit";
        if (o === "miss") return "miss";
        return i === state.qIndex && !done ? "now" : "";
      }),
    [state.outcomes, state.qIndex, done],
  );

  const theirs = useMemo(
    () => Array.from({ length: TOTAL_QUESTIONS }, (_, i) => (i < state.oppAt ? "opp" : "")),
    [state.oppAt],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-5">
      {/* scoreboard */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-3 p-3 sm:gap-5 sm:p-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-13 text-ink-2">{meName}</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <Ticker value={state.yourScore} className="text-3xl font-medium text-you" />
              <span className="text-11 text-ink-3">{state.answered}/{TOTAL_QUESTIONS}</span>
            </div>
          </div>

          <ClockRing
            progress={remaining === null ? 1 : remaining / MATCH_MS}
            label={remaining === null ? "—" : mmss(remaining)}
            low={remaining !== null && remaining < 20_000}
          />

          <div className="min-w-0 flex-1 text-right">
            <div className="truncate text-13 text-ink-2">{state.opponent || "opponent"}</div>
            <div className="mt-0.5 flex items-baseline justify-end gap-2">
              <span className="text-11 text-ink-3">{state.oppAt}/{TOTAL_QUESTIONS}</span>
              <Ticker value={state.oppScore} className="text-3xl font-medium text-them" />
            </div>
          </div>
        </div>

        <div className="flex h-0.5">
          <motion.div className="bg-you" animate={{ width: `${share * 100}%` }} transition={{ duration: 0.5, ease: EASE }} />
          <div className="flex-1 bg-them/70" />
        </div>

        <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2.5 sm:px-4">
          <div className="flex items-center gap-2.5">
            <span className="w-9 shrink-0 text-11 text-ink-3">you</span>
            <Dots states={mine} />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="w-9 shrink-0 text-11 text-ink-3">them</span>
            <Dots states={theirs} />
          </div>
        </div>
      </div>

      {status !== "open" && (
        <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-13 text-warn">
          Connection lost — rejoining. The match keeps running without you.
        </p>
      )}

      {/* stage */}
      {/* The grid lives in its own layer: .grid-fade carries a mask, and a mask
          applies to an element's children too — on the container it dimmed the
          question, the input and the button along with the lines. */}
      <div className="relative flex flex-1 flex-col items-center justify-center gap-6 py-10">
        <div className="grid-fade pointer-events-none absolute inset-0" aria-hidden="true" />
        <AnimatePresence mode="wait">
          {phase === "countdown" ? (
            <motion.div
              key="countdown"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="relative flex flex-col items-center gap-3"
            >
              <span className="eyebrow">get ready</span>
              <motion.div
                key={Math.ceil(countdownLeft / 1000)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="tnum text-[clamp(4rem,16vw,7rem)] font-medium leading-none tracking-[-0.04em]"
              >
                {countdownLeft > 0 ? Math.ceil(countdownLeft / 1000) : "go"}
              </motion.div>
              <p className="text-13 text-ink-3">Same twenty questions, same order.</p>
            </motion.div>
          ) : done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative flex w-full max-w-sm flex-col items-center gap-4 text-center"
            >
              <span className="eyebrow">your half is over</span>
              <div className="tnum text-5xl font-medium">
                {state.yourScore}
                <span className="text-ink-3">/{TOTAL_QUESTIONS}</span>
              </div>
              <p className="text-13 text-ink-2">
                Waiting for {state.opponent || "your opponent"} — {state.oppAt} of{" "}
                {TOTAL_QUESTIONS} answered.
              </p>
              <div className="h-1 w-full overflow-hidden rounded-full bg-line">
                <motion.div
                  className="h-full bg-them"
                  animate={{ width: `${(state.oppAt / TOTAL_QUESTIONS) * 100}%` }}
                  transition={{ duration: 0.5, ease: EASE }}
                />
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="question"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative flex w-full flex-col items-center gap-6"
            >
              <div className="flex items-center gap-3 text-11 text-ink-3">
                <span className="tnum">
                  question {Math.max(0, state.qIndex) + 1} of {TOTAL_QUESTIONS}
                </span>
                <span className="text-line-hi">·</span>
                <span className="tnum">{secs(solving)}</span>
                {run > 1 && (
                  <span className="flex items-center gap-1 text-warn">
                    <Flame size={11} /> {run}
                  </span>
                )}
              </div>

              <motion.div
                key={state.qIndex}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="tnum text-center text-[clamp(2.75rem,10vw,4.5rem)] font-medium leading-none tracking-[-0.045em]"
              >
                <Prompt text={state.prompt || "…"} />
              </motion.div>

              <form onSubmit={submit} className="flex w-full flex-col items-center gap-4">
                <input
                  ref={input}
                  key={`in-${state.qIndex}`}
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  aria-label="your answer"
                  placeholder="answer"
                  value={text}
                  disabled={locked}
                  onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ""))}
                  className={cx(
                    "h-14 w-56 rounded-xl border bg-panel text-center text-2xl font-medium text-ink outline-none",
                    "transition-[border-color,box-shadow] duration-150 placeholder:text-base placeholder:font-normal placeholder:text-ink-3",
                    "disabled:opacity-50",
                    flash?.correct === true && "border-good shadow-[0_0_0_3px_rgba(76,183,130,0.16)]",
                    flash?.correct === false && "animate-shake border-bad shadow-[0_0_0_3px_rgba(235,87,87,0.16)]",
                    !flash && "border-line-hi focus:border-accent focus:shadow-[0_0_0_3px_rgba(110,121,232,0.18)]",
                  )}
                />

                <div className="h-5" aria-live="polite">
                  <AnimatePresence mode="wait">
                    {flash && (
                      <motion.span
                        key={flash.at}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={cx(
                          "text-13 font-medium",
                          flash.correct ? "text-good" : "text-bad",
                        )}
                      >
                        {flash.correct ? "correct +1" : "wrong"}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>

                {keypad ? (
                  <Keypad onKey={key} onSubmit={() => submit()} disabled={locked} />
                ) : (
                  <Button variant="primary" type="submit" disabled={locked || text === ""}>
                    Submit
                  </Button>
                )}
              </form>

              {state.rejected && (
                <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-1.5 text-13 text-bad" role="alert">
                  {state.rejected}
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* footer */}
      <div className="flex items-center gap-2 text-11 text-ink-3">
        <span className="capitalize">{state.tier || "—"}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setKeypad((k) => !k)}>
          {keypad ? "Keyboard" : "Keypad"}
        </Button>
        <Button variant="ghost" size="sm" className="text-ink-3 hover:text-bad" onClick={onLeave}>
          Forfeit
        </Button>
      </div>
    </div>
  );
}
