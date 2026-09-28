import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { MotionConfig } from "motion/react";
import {
  Copy, Handshake, LogOut, Play, ScrollText, Skull, Swords, Terminal, Trophy, Zap,
} from "lucide-react";

import TopBar, { type View } from "./components/TopBar";
import ProtocolDrawer, { type LogEntry } from "./components/ProtocolDrawer";
import Landing from "./screens/Landing";
import Login from "./screens/Login";
import Duel from "./screens/Duel";
import Leaderboard from "./screens/Leaderboard";
import Lobby from "./screens/Lobby";
import Queue from "./screens/Queue";
import Result from "./screens/Result";
import System from "./screens/System";
import { health, me as fetchMe, onApiCall, type Me } from "./lib/api";
import { EMPTY_DUEL, TOTAL_QUESTIONS, type DuelState, type Phase } from "./lib/duel";
import { onAuth, signIn, signOut } from "./lib/supabase";
import { go, replace, useRoute } from "./lib/route";
import { DuelSocket, type Frame, type ServerMsg, type Status } from "./lib/socket";
import { CommandPalette, type Action } from "./ui/CommandPalette";
import { Skeleton } from "./ui/primitives";
import { Toaster, type Toast } from "./ui/Toaster";
import { TooltipProvider } from "./ui/Tooltip";

type End = Extract<ServerMsg, { t: "end" }>;

const LOG_CAP = 200;

// The protocol drawer, the command palette and the System screen are build
// tools, not features. Players never see them; `npm run dev` still does.
const DEV = import.meta.env.DEV;

export default function App() {
  const route = useRoute();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

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
  const [paletteOpen, setPaletteOpen] = useState(false);

  const sock = useRef<DuelSocket | null>(null);

  const toast = useCallback((text: string, tone?: Toast["tone"], icon?: ReactNode) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, tone, icon }]);
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
        toast(`Matched with ${m.opponent.name} · ${m.tier}`, "them", <Swords size={13} />);
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
        break;

      case "opp":
        setDuel((d) => ({ ...d, oppAt: Math.max(d.oppAt, m.qIndex + 1) }));
        break;

      case "rejected":
        // Transient. The gateway always re-serves our question after this.
        setDuel((d) => ({ ...d, rejected: m.reason }));
        toast(m.reason, "bad", <Zap size={13} />);
        break;

      case "end":
        setEnded(m);
        setPhase("over");
        toast(
          m.winner === "you" ? "You won the duel" : m.winner === "them" ? "You lost this one" : "A draw",
          m.winner === "you" ? "good" : m.winner === "them" ? "bad" : "neutral",
          m.winner === "you" ? <Trophy size={13} /> : m.winner === "them" ? <Skull size={13} /> : <Handshake size={13} />,
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
        if (st === "closed" && attempt > 0) toast("Reconnecting to the gateway…", "bad", <Zap size={13} />);
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

  const inMatch = phase === "queued" || phase === "countdown" || phase === "live";

  // Landing is always reachable; the other two depend on being signed in.
  useEffect(() => {
    if (!authReady) return;
    if (route === "play" && !session) replace("login");
    if (route === "login" && session) replace("play");
  }, [route, session, authReady]);

  useEffect(() => {
    if (!DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions = useMemo<Action[]>(() => {
    if (!DEV) return [];
    const list: Action[] = [];
    if (!inMatch) {
      list.push(
        { id: "play", group: "Match", label: "Find a match", hint: "↵", icon: <Play size={13} />, run: play },
        { id: "board", group: "Go to", label: "Leaderboard", icon: <Trophy size={13} />, run: () => setView("board") },
        { id: "system", group: "Go to", label: "System", icon: <Terminal size={13} />, run: () => setView("system") },
        { id: "lobby", group: "Go to", label: "Lobby", icon: <Swords size={13} />, run: () => setView("play") },
      );
    } else {
      list.push({
        id: "leave", group: "Match", label: phase === "queued" ? "Leave the queue" : "Forfeit this duel",
        icon: <Skull size={13} />, run: leave,
      });
    }
    list.push({
      id: "protocol", group: "Debug",
      label: logOpen ? "Hide the protocol log" : "Show the protocol log",
      hint: `${log.length} entries`, icon: <ScrollText size={13} />,
      run: () => setLogOpen((o) => !o),
    });
    if (me) {
      list.push(
        { id: "copy", group: "Account", label: "Copy user id", hint: me.username, icon: <Copy size={13} />, run: () => navigator.clipboard?.writeText(me.id) },
        { id: "out", group: "Account", label: "Sign out", icon: <LogOut size={13} />, run: () => { leave(); signOut(); } },
      );
    }
    return list;
  }, [inMatch, phase, play, leave, logOpen, log.length, me]);

  // reducedMotion="user" is the JS half of the media query in styles.css:
  // without it, motion keeps animating for people who asked it not to.
  const shell = (children: ReactNode) => (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <div className="backdrop" />
        <div className="flex min-h-dvh flex-col">{children}</div>
        <Toaster items={toasts} />
      </TooltipProvider>
    </MotionConfig>
  );

  if (!authReady) {
    return shell(
      <div className="flex flex-1 items-center justify-center">
        <Skeleton className="h-4 w-40" />
      </div>,
    );
  }

  const startSignIn = () => {
    setAuthError(null);
    setSigningIn(true);
    signIn()
      .catch((e: Error) => setAuthError(e.message))
      .finally(() => setSigningIn(false));
  };

  const publicBar = (onSignIn?: () => void) => (
    <TopBar
      me={null}
      view={view}
      onView={setView}
      apiOk={apiOk}
      ws="idle"
      showNav={false}
      dev={DEV}
      onCommand={() => setPaletteOpen(true)}
      onSignOut={signOut}
      onSignIn={onSignIn}
      onHome={() => go("home")}
    />
  );

  if (route === "home") {
    return shell(
      <>
        {publicBar(session ? undefined : () => go("login"))}
        <Landing
          signedIn={!!session}
          onStart={() => go(session ? "play" : "login")}
        />
      </>,
    );
  }

  if (!session) {
    return shell(
      <>
        {publicBar()}
        <Login
          busy={signingIn}
          error={authError}
          onSignIn={startSignIn}
          onBack={() => go("home")}
        />
      </>,
    );
  }

  const displayName = me?.username ?? session.user.email?.split("@")[0] ?? "you";

  return shell(
    <>
      <TopBar
        me={me}
        view={view}
        onView={setView}
        apiOk={apiOk}
        ws={status}
        showNav={!inMatch}
        dev={DEV}
        onCommand={() => setPaletteOpen(true)}
        onSignOut={() => { leave(); signOut(); go("home"); }}
        onHome={() => go("home")}
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
      ) : view === "system" && DEV ? (
        <System me={me} ws={status} />
      ) : (
        <Lobby
          me={me}
          meError={meError}
          onPlay={play}
          onOpenBoard={() => setView("board")}
        />
      )}

      {DEV && (
        <>
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} actions={actions} />

          <ProtocolDrawer
            open={logOpen}
            entries={log}
            onClose={() => setLogOpen(false)}
            onClear={() => setLog([])}
          />

          {!logOpen && (
            <button
              onClick={() => setLogOpen(true)}
              title="Show the live protocol: websocket frames and HTTP calls"
              className="fixed bottom-4 right-4 z-40 flex h-8 items-center gap-2 rounded-lg border border-line bg-panel/90 px-2.5 text-11 text-ink-3 backdrop-blur transition-colors duration-150 hover:border-line-hi hover:text-ink-2"
            >
              <ScrollText size={13} />
              protocol
              <span className="tnum rounded bg-panel-hi px-1 text-[10px]">{log.length}</span>
            </button>
          )}
        </>
      )}
    </>,
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
