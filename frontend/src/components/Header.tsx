import type { Me } from "../lib/api";
import type { Status } from "../lib/socket";
import { initials } from "../lib/format";

export type View = "play" | "board" | "system";

const NAV: { id: View; label: string }[] = [
  { id: "play", label: "Play" },
  { id: "board", label: "Leaderboard" },
  { id: "system", label: "System" },
];

export default function Header({
  me, view, onView, apiOk, ws, showNav, onSignOut,
}: {
  me: Me | null;
  view: View;
  onView: (v: View) => void;
  apiOk: boolean | null;
  ws: Status;
  showNav: boolean;
  onSignOut: () => void;
}) {
  const wsDot = ws === "open" ? "on" : ws === "connecting" ? "warn" : ws === "closed" ? "off" : "";

  return (
    <header className="topbar">
      <div className="brand">
        <span className="mark" aria-hidden="true">Σ</span>
        <span className="grad">MathDuel</span>
      </div>

      {showNav && (
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => onView(n.id)}
              aria-current={view === n.id ? "page" : undefined}
            >
              {n.label}
            </button>
          ))}
        </nav>
      )}

      <span className="spacer" />

      <span className="chip" title={`API ${API_LABEL[String(apiOk)]}`}>
        <i className={`dot ${apiOk === null ? "" : apiOk ? "on" : "off"}`} />
        api
      </span>
      {ws !== "idle" && (
        <span className="chip" title={`gateway socket: ${ws}`}>
          <i className={`dot ${wsDot}`} />
          ws
        </span>
      )}

      {me && (
        <div className="userchip">
          <span className="nowrap">{me.username}</span>
          <span className="avatar" aria-hidden="true">{initials(me.username)}</span>
        </div>
      )}
      {me && (
        <button className="btn ghost small" onClick={onSignOut}>
          Sign out
        </button>
      )}
    </header>
  );
}

const API_LABEL: Record<string, string> = {
  null: "checking…",
  true: "reachable",
  false: "unreachable",
};
