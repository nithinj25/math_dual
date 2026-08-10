import { useState } from "react";

import { TIERS, board, standing, type Me, type Tier } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { ordinal, shortId } from "../lib/format";

const LIMITS = [10, 20, 50, 100];

export default function Leaderboard({ me }: { me: Me | null }) {
  const [tier, setTier] = useState<Tier>("intermediate");
  const [weekly, setWeekly] = useState(false);
  const [limit, setLimit] = useState(20);

  const data = usePolled(
    () =>
      Promise.all([
        board(tier, weekly, limit),
        me ? standing(tier, me.id, weekly) : Promise.resolve(null),
      ]),
    [tier, weekly, limit, me?.id],
  );

  const [rows, mine] = data.data ?? [null, null];
  const top = rows?.entries[0]?.points ?? 0;

  return (
    <div className="page">
      <div className="row between wrap gap-m">
        <div className="stack">
          <h1 style={{ fontSize: "2rem" }}>Leaderboard</h1>
          <p className="dim small">
            Ladder points, not rating: a win is 3, a draw is 1, a loss is 0. Weekly boards
            reset with the ISO week.
          </p>
        </div>
        <button className="btn ghost small" onClick={data.refresh} disabled={data.loading}>
          {data.loading ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      <div className="board-controls">
        <div className="segment">
          {TIERS.map((t) => (
            <button key={t} aria-pressed={tier === t} onClick={() => setTier(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="segment">
          <button aria-pressed={!weekly} onClick={() => setWeekly(false)}>All time</button>
          <button aria-pressed={weekly} onClick={() => setWeekly(true)}>This week</button>
        </div>
        <span className="spacer" />
        <div className="segment">
          {LIMITS.map((n) => (
            <button key={n} aria-pressed={limit === n} onClick={() => setLimit(n)}>
              top {n}
            </button>
          ))}
        </div>
      </div>

      {mine && (
        <div className="banner info rise">
          <i className="dot on" />
          <span>
            You sit <b>{ordinal(mine.rank)}</b> of {mine.of} on the {weekly ? "weekly" : "all-time"}{" "}
            {tier} board with <b>{Math.round(mine.points)}</b> points.
          </span>
        </div>
      )}

      <section className="panel">
        {data.error && <p className="banner bad">{data.error}</p>}

        {data.loading && !rows && (
          <div className="stack gap-s">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="shimmer" style={{ height: "2.4rem" }} />
            ))}
          </div>
        )}

        {rows && rows.entries.length === 0 && (
          <p className="empty">
            Nobody is on the {weekly ? "weekly" : "all-time"} {tier} board yet.
            <br />
            Play a match and you will be the first.
          </p>
        )}

        {rows && rows.entries.length > 0 && (
          <table className="ranks">
            <thead>
              <tr>
                <th style={{ width: "3.5rem" }}>#</th>
                <th>player</th>
                <th className="n" style={{ width: "8rem" }}>points</th>
              </tr>
            </thead>
            <tbody>
              {rows.entries.map((r) => {
                const isMe = me?.id === r.user_id;
                return (
                  <tr key={r.user_id} className={isMe ? "is-me" : ""}>
                    <td>
                      <span className={`medal ${r.rank <= 3 ? `g${r.rank}` : ""}`}>{r.rank}</span>
                    </td>
                    <td>
                      <div className="row gap-s">
                        <span className="mono">{shortId(r.user_id)}</span>
                        {isMe && <span className="chip me">you</span>}
                      </div>
                    </td>
                    <td className="n">
                      <span className="pts">{Math.round(r.points)}</span>
                      <div
                        className="pts-bar"
                        style={{ width: `${top ? (r.points / top) * 100 : 0}%`, marginLeft: "auto" }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <p className="tiny faint">
        The board is keyed by the API's own users.id, which is why players show as short
        ids — the leaderboard endpoint returns ids and points, nothing else.
      </p>
    </div>
  );
}
