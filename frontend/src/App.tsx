import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";

import Header, { type View } from "./components/Header";
import ProtocolLog, { type LogEntry } from "./components/ProtocolLog";
import Toasts, { type Toast } from "./components/Toasts";
import Duel from "./screens/Duel";
import Landing from "./screens/Landing";
import Leaderboard from "./screens/Leaderboard";
import Lobby from "./screens/Lobby";
import Queue from "./screens/Queue";
import Result from "./screens/Result";
import System from "./screens/System";
import Arena from "./three/Arena";
import { health, me as fetchMe, onApiCall, type Me } from "./lib/api";
import { EMPTY_DUEL, TOTAL_QUESTIONS, type DuelState, type Phase } from "./lib/duel";
import { onAuth, signIn, signOut } from "./lib/supabase";
import { DuelSocket, type Frame, type ServerMsg, type Status } from "./lib/socket";
import "./App.css";

type End = Extract<ServerMsg, { t: "end" }>;

const LOG_CAP = 200;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  const [view, setView] = useState<View>("play");
  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState<Status>("idle");
  const [duel, setDuel] = useState<DuelState>(EMPTY_DUEL);
  const [ended, setEnded] = useState<End | null>(null);
  const [queuedAt, setQueuedAt] = useState(0);
  const [searchWindow, setSearchWindow] = useState<number | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);

  // Bumped counters — the arena flashes whenever one of these changes.
  const [meFlash, setMeFlash] = useState(0);
  const [themFlash, setThemFlash] = useState(0);
  const sock = useRef<DuelSocket | null>(null);

  const toast = useCallback((text: string, kind?: Toast["kind"], icon?: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, kind, icon }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3600);
  }, []);

  const push = useCallback((entry: LogEntry) => {
    setLog((list) => [entry, ...list].slice(0, LOG_CAP));
  }, []);

  useEffect(() => onAuth((s) => { setSession(s); setAuthReady(true); }), []);
  useEffect(() => () => sock.current?.close(), []);

  // Every HTTP call the client makes shows up in the protocol drawer.
  useEffect(
    () =>
      onApiCall((c) =>
        push({
          id: `a${c.id}`,
          kind: c.ok ? "rest" : "err",
          label: `${c.method} ${c.path}`,
          detail: `${c.status || "failed"} · ${c.ms}ms`,
          at: c.at,
        }),
      ),
    [push],
  );

  // Who does the API think we are? The leaderboard is keyed by this id, not
  // by the Supabase uid, so nothing user-specific works without it.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) { setMe(null); return; }
    let dead = false;
    fetchMe(token)
      .then((u) => !dead && (setMe(u), setMeError(null)))
      .catch((e: Error) => !dead && setMeError(e.message));
    return () => { dead = true; };
  }, [session?.user.id, session?.access_token]);

  useEffect(() => {
    let dead = false;
    const ping = () =>
      health()
        .then(() => !dead && setApiOk(true))
        .catch(() => !dead && setApiOk(false));
    ping();
    const id = setInterval(ping, 20_000);
    return () => { dead = true; clearInterval(id); };
  }, []);

  // Every field below is a cache of what the server last said.
  // Nothing here is computed locally — that is the whole design.
  const handle = useCallback((m: ServerMsg) => {
    switch (m.t) {
      case "waiting":
        setPhase("queued");
        setSearchWindow(m.window ?? null);
        break;

      case "matched":
        // Arrives again after a reconnect. Keep our scores if it is the
        // same match, or the board visibly wipes for a moment.
        setDuel((d) =>
          d.matchId === m.matchId
            ? d
            : {
                ...EMPTY_DUEL,
                outcomes: Array(TOTAL_QUESTIONS).fill(null),
                solveMs: [],
                matchId: m.matchId,
                opponent: m.opponent.name,
                tier: m.tier,
              });
        setEnded(null);
        setPhase((p) => (p === "live" ? "live" : "countdown"));
        toast(`Matched with ${m.opponent.name} · ${m.tier}`, "them", "⚔️");
        break;

      case "countdown":
        setDuel((d) => ({ ...d, liveAt: Date.now() + m.startsInMs }));
        setPhase((p) => (p === "live" ? "live" : "countdown"));
        break;

      case "question":
        setPhase("live");
        setDuel((d) => ({
          ...d,
          qIndex: m.qIndex,
          prompt: m.prompt,
          shownAt: Date.now(),
          rejected: null,
        }));
        break;

      case "result":
        setDuel((d) => {
          const outcomes = d.outcomes.slice();
          outcomes[m.qIndex] = m.correct ? "hit" : "miss";
          const solveMs = d.solveMs.slice();
          solveMs[m.qIndex] = d.shownAt ? Date.now() - d.shownAt : 0;
          return {
            ...d,
            yourScore: m.yourScore,
            oppScore: m.oppScore,
            answered: Math.max(d.answered, m.qIndex + 1),
            outcomes,
            solveMs,
            rejected: null,
            last: { qIndex: m.qIndex, correct: m.correct, at: Date.now() },
          };
        });
        if (m.correct) setMeFlash((n) => n + 1);
        break;

      case "opp":
        setDuel((d) => ({ ...d, oppAt: Math.max(d.oppAt, m.qIndex + 1) }));
        setThemFlash((n) => n + 1);
        break;

      case "rejected":
        // Transient. The gateway always re-serves our question after this.
        setDuel((d) => ({ ...d, rejected: m.reason }));
        toast(m.reason, "bad", "⚠️");
        break;

      case "end":
        setEnded(m);
        setPhase("over");
        toast(
          m.winner === "you" ? "You won the duel" : m.winner === "them" ? "You lost this one" : "A draw",
          m.winner === "you" ? "good" : m.winner === "them" ? "bad" : "",
          m.winner === "you" ? "🏆" : m.winner === "them" ? "💀" : "🤝",
        );
        // Nothing follows an end frame, so release the socket — but only if
        // "play again" has not already replaced it in the meantime.
        {
          const finished = sock.current;
          setTimeout(() => {
            if (sock.current !== finished) return;
            finished?.close();
            sock.current = null;
          }, 400);
        }
        break;
    }
  }, [toast]);

  const onFrame = useCallback(
    (f: Frame) =>
      push({ id: `f${f.id}`, kind: f.dir, label: f.t, detail: describe(f), at: f.at }),
    [push],
  );

  const play = useCallback(() => {
    const token = session?.access_token;
    if (!token) return;
    sock.current?.close();
    setDuel({ ...EMPTY_DUEL, outcomes: Array(TOTAL_QUESTIONS).fill(null), solveMs: [] });
    setEnded(null);
    setSearchWindow(null);
    setQueuedAt(Date.now());
    setPhase("queued");
    setView("play");

    const s = new DuelSocket({
      token,
      onMsg: handle,
      onStatus: (st, attempt) => {
        setStatus(st);
        if (st === "closed" && attempt > 0) toast("Reconnecting to the gateway…", "bad", "⚡");
      },
      onFrame,
    });
    sock.current = s;
    s.connect();
  }, [session?.access_token, handle, onFrame, toast]);

  const leave = useCallback(() => {
    sock.current?.close();
    sock.current = null;
    setPhase("idle");
    setDuel(EMPTY_DUEL);
    setEnded(null);
    setStatus("idle");
  }, []);

  // Drives the arena: which way the field leans, and how alive it is.
  const balance = Math.max(-1, Math.min(1, (duel.yourScore - duel.oppScore) / 8));
  const energy =
    phase === "live" ? 1 : phase === "countdown" ? 0.7 : phase === "queued" ? 0.4 : 0.15;
  const arena = (
    <Arena balance={balance} energy={energy} meFlash={meFlash} themFlash={themFlash} />
  );

  if (!authReady) {
    return (
      <>
        {arena}
        <div className="app">
          <div className="page middle center">
            <div className="shimmer" style={{ width: "12rem", height: "1.2rem" }} />
          </div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        {arena}
        <div className="app">
          <Header
            me={null}
            view={view}
            onView={setView}
            apiOk={apiOk}
            ws="idle"
            showNav={false}
            onSignOut={signOut}
          />
          <Landing
            busy={signingIn}
            error={authError}
            onSignIn={() => {
              setAuthError(null);
              setSigningIn(true);
              signIn()
                .catch((e: Error) => setAuthError(e.message))
                .finally(() => setSigningIn(false));
            }}
          />
        </div>
      </>
    );
  }

  const inMatch = phase === "queued" || phase === "countdown" || phase === "live";
  const displayName = me?.username ?? session.user.email?.split("@")[0] ?? "you";

  return (
    <>
      {arena}
      <div className="app">
        <Header
          me={me}
          view={view}
          onView={setView}
          apiOk={apiOk}
          ws={status}
          showNav={!inMatch}
          onSignOut={() => { leave(); signOut(); }}
        />

        {phase === "queued" ? (
          <Queue since={queuedAt} searchWindow={searchWindow} ws={status} onCancel={leave} />
        ) : phase === "countdown" || phase === "live" ? (
          <Duel
            state={duel}
            phase={phase}
            status={status}
            meName={displayName}
            onAnswer={(v) => sock.current?.answer(duel.qIndex, v)}
            onLeave={leave}
          />
        ) : phase === "over" && ended ? (
          <Result
            end={ended}
            duel={duel}
            me={me}
            onAgain={play}
            onHome={leave}
            onBoard={() => { leave(); setView("board"); }}
          />
        ) : view === "board" ? (
          <Leaderboard me={me} />
        ) : view === "system" ? (
          <System me={me} ws={status} />
        ) : (
          <Lobby
            me={me}
            meError={meError}
            onPlay={play}
            onOpenBoard={() => setView("board")}
          />
        )}
      </div>

      <Toasts items={toasts} />

      {logOpen ? (
        <ProtocolLog entries={log} onClose={() => setLogOpen(false)} onClear={() => setLog([])} />
      ) : (
        <button
          className="btn ghost small log-toggle"
          onClick={() => setLogOpen(true)}
          title="Show the live protocol: websocket frames and HTTP calls"
        >
          ⌥ protocol
        </button>
      )}
    </>
  );
}

/** One-line summary of a frame for the protocol drawer. */
function describe(f: Frame): string {
  const b = f.body as Record<string, unknown>;
  const num = (k: string) => String(b[k] ?? "?");
  switch (f.t) {
    case "join":
      return "token → gateway";
    case "answer":
      return `q${num("qIndex")} = ${num("value")}`;
    case "waiting":
      return b.window === undefined ? "queued" : `search ±${num("window")}`;
    case "matched":
      return `${(b.opponent as { name?: string } | undefined)?.name ?? "?"} · ${num("tier")}`;
    case "countdown":
      return `starts in ${num("startsInMs")}ms`;
    case "question":
      return `q${num("qIndex")} · ${num("prompt")}`;
    case "result":
      return `q${num("qIndex")} ${b.correct ? "✓" : "✗"} → ${num("yourScore")}–${num("oppScore")}`;
    case "opp":
      return `opponent finished q${num("qIndex")}`;
    case "rejected":
      return num("reason");
    case "end": {
      const score = (b.score as number[] | undefined) ?? [];
      return `${num("winner")} ${score.join("–")} · Δ${num("ratingDelta")}`;
    }
    default:
      return "";
  }
}
