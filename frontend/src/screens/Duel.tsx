import { useEffect, useMemo, useRef, useState } from "react";

import ClockRing from "../components/ClockRing";
import Keypad from "../components/Keypad";
import { MATCH_MS, TOTAL_QUESTIONS, streak, type DuelState, type Phase } from "../lib/duel";
import { initials, mmss, secs, shortId } from "../lib/format";
import { useCountUp, useNow } from "../lib/hooks";
import type { Status } from "../lib/socket";

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

  const yourScore = useCountUp(state.yourScore);
  const oppScore = useCountUp(state.oppScore);

  // New question: clear the box and put the cursor back.
  useEffect(() => {
    setText("");
    input.current?.focus();
  }, [state.qIndex]);

  // The server's verdict on the last answer, shown for a beat.
  useEffect(() => {
    if (!state.last) return;
    setFlash({ correct: state.last.correct, at: state.last.at });
    const id = setTimeout(() => setFlash(null), 1100);
    return () => clearTimeout(id);
  }, [state.last]);

  // The gateway simply stops serving questions once you have answered all
  // twenty, so the client has to recognise that state itself.
  const done = state.answered >= TOTAL_QUESTIONS;
  const locked = status !== "open" || phase !== "live" || done;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const raw = text.trim();
    if (raw === "" || locked) return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    onAnswer(value);                 // App supplies state.qIndex — never a local counter
    setText("");
    input.current?.focus();
  }

  function key(k: string) {
    if (k === "⌫") return setText((t) => t.slice(0, -1));
    if (k === "-") return setText((t) => (t.startsWith("-") ? t.slice(1) : `-${t}`));
    setText((t) => (t.length < 10 ? t + k : t));
  }

  const remaining = state.liveAt === null ? null : state.liveAt + MATCH_MS - now;
  const countdownLeft = state.liveAt === null ? 0 : state.liveAt - now;
  const solving = state.shownAt ? now - state.shownAt : 0;
  const run = streak(state);

  // A smoothed share of the bar, so 0–0 sits in the middle instead of empty.
  const share = (state.yourScore + 1) / (state.yourScore + state.oppScore + 2);

  const dots = useMemo(
    () =>
      Array.from({ length: TOTAL_QUESTIONS }, (_, i) => {
        const o = state.outcomes[i];
        if (o === "hit") return "hit";
        if (o === "miss") return "miss";
        return i === state.qIndex ? "now" : "";
      }),
    [state.outcomes, state.qIndex],
  );

  return (
    <div className="page narrow duel">
      <div className="duel-head">
        <div className={`side-card ${flash?.correct ? "flash" : ""}`}>
          <span className="avatar" aria-hidden="true">{initials(meName)}</span>
          <span className="who">
            <b>{meName}</b>
            <span className="tiny faint">{state.answered}/{TOTAL_QUESTIONS} answered</span>
          </span>
          <span className="score">{yourScore}</span>
        </div>

        <ClockRing
          progress={remaining === null ? 1 : remaining / MATCH_MS}
          label={remaining === null ? "—" : mmss(remaining)}
          low={remaining !== null && remaining < 20_000}
        />

        <div className="side-card them">
          <span className="avatar them" aria-hidden="true">
            {initials(state.opponent || "opponent")}
          </span>
          <span className="who">
            <b>{state.opponent || "opponent"}</b>
            <span className="tiny faint">{state.oppAt}/{TOTAL_QUESTIONS} answered</span>
          </span>
          <span className="score">{oppScore}</span>
        </div>
      </div>

      <div className="tug" role="img" aria-label={`score ${state.yourScore} to ${state.oppScore}`}>
        <i className="me" style={{ width: `${share * 100}%` }} />
        <i className="them" style={{ width: `${(1 - share) * 100}%` }} />
      </div>

      <div className="stack gap-s">
        <div className="row gap-s">
          <span className="upper" style={{ width: "2.6rem" }}>you</span>
          <div className="dots grow">
            {dots.map((c, i) => <i key={i} className={c} />)}
          </div>
        </div>
        <div className="row gap-s">
          <span className="upper" style={{ width: "2.6rem" }}>them</span>
          <div className="dots grow">
            {Array.from({ length: TOTAL_QUESTIONS }, (_, i) => (
              <i key={i} className={i < state.oppAt ? "opp" : ""} />
            ))}
          </div>
        </div>
      </div>

      {status !== "open" && (
        <p className="banner warn">
          <i className="dot warn" /> Connection lost — rejoining. The match keeps running.
        </p>
      )}

      <section className="panel stage">
        {phase === "countdown" ? (
          <>
            <span className="upper">get ready</span>
            <div className="countdown-num" key={Math.ceil(countdownLeft / 1000)}>
              {countdownLeft > 0 ? Math.ceil(countdownLeft / 1000) : "GO"}
            </div>
            <p className="dim">
              Both of you get the same twenty questions, in the same order.
            </p>
          </>
        ) : done ? (
          <>
            <span className="upper">your half is over</span>
            <div className="countdown-num" style={{ fontSize: "clamp(3rem,12vw,5rem)" }}>
              {state.yourScore}/{TOTAL_QUESTIONS}
            </div>
            <p className="dim" style={{ maxWidth: "38ch" }}>
              All twenty answered. {state.opponent || "Your opponent"} is on{" "}
              {state.oppAt}/{TOTAL_QUESTIONS} — the result lands when they finish or the
              clock runs out.
            </p>
            <div className="window-bar">
              <i style={{ width: `${(state.oppAt / TOTAL_QUESTIONS) * 100}%` }} />
            </div>
          </>
        ) : (
          <>
            <div className="qmeta">
              <span>question {Math.max(0, state.qIndex) + 1} / {TOTAL_QUESTIONS}</span>
              <span>·</span>
              <span>{secs(solving)}</span>
              {run > 1 && <span className="chip good">🔥 {run} in a row</span>}
            </div>

            <div className="prompt" key={state.qIndex}>
              {state.prompt || "…"}
            </div>

            <form className="answer-form" onSubmit={submit}>
              <input
                ref={input}
                className={`answer-input ${flash ? (flash.correct ? "good" : "bad") : ""}`}
                key={`in-${state.qIndex}`}
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                aria-label="your answer"
                value={text}
                onChange={(e) => setText(e.target.value.replace(/[^\d-]/g, ""))}
                placeholder="answer"
                disabled={locked}
              />

              <div aria-live="polite" style={{ minHeight: "1.5rem" }}>
                {flash && (
                  <span className={`verdict-flash ${flash.correct ? "good" : "bad"}`}>
                    {flash.correct ? "correct  +1" : "wrong"}
                  </span>
                )}
              </div>

              {keypad ? (
                <Keypad onKey={key} onSubmit={() => submit()} disabled={locked} />
              ) : (
                <button className="btn primary" type="submit" disabled={locked || text === ""}>
                  Submit
                </button>
              )}
            </form>

            {state.rejected && (
              <p className="banner bad" role="alert">
                <i className="dot off" /> {state.rejected}
              </p>
            )}
          </>
        )}
      </section>

      <div className="row gap-s wrap">
        <span className="chip">{state.tier || "—"}</span>
        <span className="chip mono" title={state.matchId}>
          {state.matchId ? shortId(state.matchId) : "—"}
        </span>
        <span className="chip">seed shared · questions identical</span>
        <span className="spacer" />
        <button
          className="btn ghost small"
          onClick={() => setKeypad((k) => !k)}
        >
          {keypad ? "Use keyboard" : "Use keypad"}
        </button>
        <button className="btn ghost small danger" onClick={onLeave}>Forfeit</button>
      </div>
    </div>
  );
}
