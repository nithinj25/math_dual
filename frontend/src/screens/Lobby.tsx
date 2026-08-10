import { useEffect, useState } from "react";

import { TIERS, TIER_BANDS, type Me, type Tier, myRoom, queueSize, standing } from "../lib/api";
import { usePolled } from "../lib/hooks";
import { dateOnly, ordinal, shortId } from "../lib/format";

export default function Lobby({
  me, meError, onPlay, onOpenBoard,
}: {
  me: Me | null;
  meError: string | null;
  onPlay: () => void;
  onOpenBoard: () => void;
}) {
  const [weekly, setWeekly] = useState(false);

  const queues = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 8000);
  const room = usePolled(() => (me ? myRoom(me.id) : Promise.resolve(null)), [me?.id], 15_000);
  const ranks = usePolled(
    () =>
      me
        ? Promise.all(TIERS.map((t) => standing(t, me.id, weekly)))
        : Promise.resolve<(null)[]>([]),
    [me?.id, weekly],
  );

  // Enter starts a match from anywhere on this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLInputElement)) onPlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPlay]);

  const totalWaiting = queues.data?.reduce((n, q) => n + q.waiting, 0) ?? null;
  const ranked = ranks.data?.filter(Boolean) ?? [];

  return (
    <div className="page">
      {meError && (
        <p className="banner warn">
          Signed in, but the API would not identify you: {meError}. You can still play —
          the gateway resolves your token itself.
        </p>
      )}

      {room.data && (
        <div className="banner info rise">
          <i className="dot warn" />
          <span>
            You are already in match <b className="mono">{room.data.match_id}</b> ({room.data.tier}).
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={onPlay}>Rejoin</button>
        </div>
      )}

      <div className="lobby">
        <div className="stack gap-m">
          <section className="panel play-card rise">
            <h2>Ready when you are.</h2>
            <p className="dim" style={{ maxWidth: "34ch" }}>
              We pair you with the closest rating we can find, and widen the search
              every three seconds until someone turns up.
            </p>
            <button className="btn primary big" onClick={onPlay}>Find a match</button>
            <p className="tiny faint">
              or press <span className="kbd">Enter</span>
              {totalWaiting !== null && ` · ${totalWaiting} waiting across all tiers`}
            </p>
          </section>

          <section className="panel rise">
            <div className="panel-title">
              <h3>How a duel runs</h3>
            </div>
            <ol className="stack gap-s dim small" style={{ margin: 0, paddingLeft: "1.1rem" }}>
              <li>You join the queue for your tier; the gateway polls until it pairs you.</li>
              <li>Both clients get <span className="mono">matched</span>, then a 3 second countdown.</li>
              <li>Twenty questions, served one at a time — you only ever see your own next one.</li>
              <li>Two minutes on the clock. Answering all twenty early ends your half.</li>
              <li>More correct wins; a tie breaks on total solve time; otherwise it's a draw.</li>
              <li>Glicko-2 rates the result, and ladder points land on the board: 3 / 1 / 0.</li>
            </ol>
          </section>
        </div>

        <div className="stack gap-m">
          <section className="panel rise">
            <div className="panel-title">
              <h3>Live lobby</h3>
              <span className="spacer" />
              {queues.loading && <span className="tiny faint">syncing…</span>}
            </div>

            {queues.error && <p className="banner bad small">{queues.error}</p>}

            {TIERS.map((tier, i) => (
              <div className="tier-row" key={tier}>
                <i className={`tier-badge ${tier}`} />
                <div className="stack">
                  <span className="name">{tier}</span>
                  <span className="band">rating {TIER_BANDS[tier as Tier]}</span>
                </div>
                <span className={`chip ${queues.data?.[i].waiting ? "me" : ""}`}>
                  {queues.data ? `${queues.data[i].waiting} waiting` : "—"}
                </span>
              </div>
            ))}
          </section>

          <section className="panel rise">
            <div className="panel-title">
              <h3>Your standing</h3>
              <span className="spacer" />
              <div className="segment">
                <button aria-pressed={!weekly} onClick={() => setWeekly(false)}>All time</button>
                <button aria-pressed={weekly} onClick={() => setWeekly(true)}>Weekly</button>
              </div>
            </div>

            {ranks.loading && <div className="shimmer" style={{ height: "3.5rem" }} />}
            {ranks.error && <p className="banner bad small">{ranks.error}</p>}

            {!ranks.loading && ranked.length === 0 && (
              <p className="dim small">
                You are not on any board yet — win, draw or lose one match and you will be.
              </p>
            )}

            {ranks.data?.map((s, i) =>
              s ? (
                <div className="kv" key={TIERS[i]}>
                  <dt style={{ textTransform: "capitalize" }}>{TIERS[i]}</dt>
                  <dd>
                    <b style={{ color: "var(--me)" }}>{ordinal(s.rank)}</b>
                    <span className="faint"> of {s.of} · {Math.round(s.points)} pts</span>
                  </dd>
                </div>
              ) : null,
            )}

            <button className="btn ghost small" style={{ marginTop: ".75rem" }} onClick={onOpenBoard}>
              Open the leaderboard →
            </button>
          </section>

          {me && (
            <section className="panel rise">
              <div className="panel-title">
                <h3>You</h3>
              </div>
              <dl style={{ margin: 0 }}>
                <div className="kv"><dt>username</dt><dd>{me.username}</dd></div>
                <div className="kv"><dt>email</dt><dd>{me.email ?? "—"}</dd></div>
                <div className="kv"><dt>user id</dt><dd title={me.id}>{shortId(me.id)}…</dd></div>
                <div className="kv"><dt>provider</dt><dd>{me.auth_provider}</dd></div>
                <div className="kv"><dt>joined</dt><dd>{dateOnly(me.created_at)}</dd></div>
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
