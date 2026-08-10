import { clockTime } from "../lib/format";

export interface LogEntry {
  id: string;
  kind: "in" | "out" | "rest" | "err";
  label: string;
  detail: string;
  at: number;
}

const TAG: Record<LogEntry["kind"], string> = {
  in: "WS ◂",
  out: "WS ▸",
  rest: "HTTP",
  err: "ERR",
};

/** A live view of the actual protocol: every websocket frame in either
 *  direction and every HTTP call, newest first. */
export default function ProtocolLog({
  entries, onClose, onClear,
}: {
  entries: LogEntry[];
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="log-drawer" aria-label="Protocol log">
      <div className="log-head">
        <b style={{ fontFamily: "var(--display)" }}>Protocol</b>
        <span className="chip">{entries.length}</span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onClear}>Clear</button>
        <button className="icon-btn" onClick={onClose} aria-label="Close protocol log">✕</button>
      </div>

      <div className="log-body">
        {entries.length === 0 && (
          <p className="faint small" style={{ padding: "1rem" }}>
            Nothing yet. Frames and HTTP calls appear here as they happen.
          </p>
        )}
        {entries.map((e) => (
          <div key={e.id} className="log-line">
            <span className="when">{clockTime(e.at)}</span>
            <span className={`tag ${e.kind}`}>{TAG[e.kind]}</span>
            <span className="what">
              <b>{e.label}</b> {e.detail}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
