import { TIERS, queueSize } from "../lib/api";
import { useNow, usePolled } from "../lib/hooks";
import type { Status } from "../lib/socket";

const MAX_WINDOW = 1000; // matchmaking/queue.py

export default function Queue({
  since, searchWindow, ws, onCancel,
}: {
  since: number;
  searchWindow: number | null;
  ws: Status;
  onCancel: () => void;
}) {
  const now = useNow(200);
  const elapsed = Math.max(0, now - since);
  const queues = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 5000);
  const waiting = queues.data?.reduce((n, q) => n + q.waiting, 0) ?? null;

  return (
    <div className="page middle">
      <section className="queue">
        <div className="radar" aria-hidden="true">
          <i className="radar-ring" />
          <i className="radar-ring" />
          <i className="radar-ring" />
          <div className="core">{(elapsed / 1000).toFixed(1)}s</div>
        </div>

        <h2>Looking for an opponent…</h2>
        <p className="dim" style={{ maxWidth: "40ch" }}>
          The search starts at ±50 rating and widens by 50 every three seconds.
          Speed beats precision here: an empty lobby is worse than an imperfect match.
        </p>

        <div className="window-bar" title="how wide the rating search is">
          <i style={{ width: `${Math.min(100, ((searchWindow ?? 50) / MAX_WINDOW) * 100)}%` }} />
        </div>
        <div className="row gap-s wrap center">
          <span className="chip me">± {searchWindow ?? 50} rating</span>
          <span className="chip">{waiting === null ? "—" : `${waiting} in queue`}</span>
          <span className="chip">
            <i className={`dot ${ws === "open" ? "on" : ws === "connecting" ? "warn" : "off"}`} />
            {ws === "open" ? "connected" : ws === "connecting" ? "connecting" : "reconnecting"}
          </span>
        </div>

        {ws === "closed" && (
          <p className="banner warn">
            Lost the gateway. Retrying — your place in the queue is restored on rejoin.
          </p>
        )}

        <button className="btn ghost" onClick={onCancel}>Cancel</button>
      </section>
    </div>
  );
}
