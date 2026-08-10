import { useState } from "react";

import {
  API_URL, ENDPOINTS, GATEWAY_URL, TIERS, health, myRoom, queueSize,
  rebuildBoard, room, snapshotBoard, type Me, type Room, type Tier,
} from "../lib/api";
import { usePolled } from "../lib/hooks";
import type { Status } from "../lib/socket";

export default function System({ me, ws }: { me: Me | null; ws: Status }) {
  const [matchId, setMatchId] = useState("");
  const [found, setFound] = useState<Room | null | "none">(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [opsTier, setOpsTier] = useState<Tier>("intermediate");
  const [opsWeekly, setOpsWeekly] = useState(false);
  const [opsBusy, setOpsBusy] = useState(false);
  const [opsResult, setOpsResult] = useState<string | null>(null);

  const ping = usePolled(
    async () => {
      const t0 = performance.now();
      const r = await health();
      return { status: r.status, ms: Math.round(performance.now() - t0) };
    },
    [],
    10_000,
  );

  const queues = usePolled(() => Promise.all(TIERS.map((t) => queueSize(t))), [], 6000);

  async function lookup(id: string) {
    setLookupError(null);
    setFound(null);
    try {
      const r = await room(id.trim());
      setFound(r ?? "none");
    } catch (e) {
      setLookupError((e as Error).message);
    }
  }

  async function lookupMine() {
    if (!me) return;
    setLookupError(null);
    setFound(null);
    try {
      const r = await myRoom(me.id);
      setFound(r ?? "none");
      if (r) setMatchId(r.match_id);
    } catch (e) {
      setLookupError((e as Error).message);
    }
  }

  async function runOp(kind: "rebuild" | "snapshot") {
    setOpsBusy(true);
    setOpsResult(null);
    try {
      if (kind === "rebuild") {
        const r = await rebuildBoard(opsTier);
        setOpsResult(`rebuilt ${r.tier} from Postgres — ${r.players} players restored`);
      } else {
        const r = await snapshotBoard(opsTier, opsWeekly);
        setOpsResult(`snapshotted ${r.tier} (${opsWeekly ? "weekly" : "global"}) — ${r.rows} rows written`);
      }
    } catch (e) {
      setOpsResult(`failed: ${(e as Error).message}`);
    } finally {
      setOpsBusy(false);
    }
  }

  return (
    <div className="page wide">
      <div className="stack">
        <h1 style={{ fontSize: "2rem" }}>System</h1>
        <p className="dim small">
          Everything this client can see of the running stack — and every endpoint it uses.
        </p>
      </div>

      <div className="sys-grid">
        <section className="panel">
          <div className="panel-title">
            <h3>Services</h3>
          </div>
          <dl style={{ margin: 0 }}>
            <div className="kv">
              <dt>api</dt>
              <dd>
                <i className={`dot ${ping.error ? "off" : ping.data ? "on" : "warn"}`} />{" "}
                {ping.error ? "unreachable" : ping.data ? `${ping.data.status} · ${ping.data.ms}ms` : "checking…"}
              </dd>
            </div>
            <div className="kv"><dt>api url</dt><dd>{API_URL}</dd></div>
            <div className="kv">
              <dt>gateway socket</dt>
              <dd>
                <i className={`dot ${ws === "open" ? "on" : ws === "idle" ? "" : ws === "connecting" ? "warn" : "off"}`} />{" "}
                {ws}
              </dd>
            </div>
            <div className="kv"><dt>gateway url</dt><dd>{GATEWAY_URL}</dd></div>
            <div className="kv"><dt>your users.id</dt><dd>{me?.id ?? "—"}</dd></div>
          </dl>
          {ping.error && <p className="banner bad small" style={{ marginTop: ".75rem" }}>{ping.error}</p>}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h3>Matchmaking queues</h3>
            <span className="spacer" />
            <button className="btn ghost small" onClick={queues.refresh}>↻</button>
          </div>
          {TIERS.map((t, i) => (
            <div className="kv" key={t}>
              <dt style={{ textTransform: "capitalize" }}>{t}</dt>
              <dd>{queues.data ? `${queues.data[i].waiting} waiting` : "—"}</dd>
            </div>
          ))}
          <p className="tiny faint" style={{ marginTop: ".75rem" }}>
            A Redis sorted set per tier, scored by rating. Pairing is one atomic Lua call,
            so two callers can never claim the same opponent.
          </p>
        </section>

        <section className="panel">
          <div className="panel-title">
            <h3>Room inspector</h3>
          </div>
          <div className="field">
            <input
              className="input"
              placeholder="m_1a2b3c4d"
              value={matchId}
              onChange={(e) => setMatchId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookup(matchId)}
            />
            <button className="btn small" onClick={() => lookup(matchId)} disabled={!matchId.trim()}>
              Look up
            </button>
          </div>
          <button className="btn ghost small" style={{ marginTop: ".6rem" }} onClick={lookupMine} disabled={!me}>
            My current room
          </button>

          {lookupError && <p className="banner bad small" style={{ marginTop: ".75rem" }}>{lookupError}</p>}
          {found === "none" && (
            <p className="dim small" style={{ marginTop: ".75rem" }}>
              No such room. Rooms live in Redis for ten minutes after the match.
            </p>
          )}
          {found && found !== "none" && (
            <pre className="json" style={{ marginTop: ".75rem" }}>
              {JSON.stringify(found, null, 2)}
            </pre>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            <h3>Board maintenance</h3>
          </div>
          <p className="dim small">
            Operational endpoints. Rebuild recomputes a global board from the rated matches
            in Postgres; snapshot writes the current board into leaderboard_snapshots.
          </p>
          <div className="row gap-s wrap" style={{ marginTop: ".8rem" }}>
            <div className="segment">
              {TIERS.map((t) => (
                <button key={t} aria-pressed={opsTier === t} onClick={() => setOpsTier(t)}>{t}</button>
              ))}
            </div>
            <label className="row gap-s small dim">
              <input
                type="checkbox"
                checked={opsWeekly}
                onChange={(e) => setOpsWeekly(e.target.checked)}
              />
              weekly scope
            </label>
          </div>
          <div className="row gap-s wrap" style={{ marginTop: ".8rem" }}>
            <button className="btn small" onClick={() => runOp("rebuild")} disabled={opsBusy}>
              Rebuild from Postgres
            </button>
            <button className="btn small" onClick={() => runOp("snapshot")} disabled={opsBusy}>
              Take snapshot
            </button>
          </div>
          {opsResult && (
            <p className={`banner small ${opsResult.startsWith("failed") ? "bad" : "info"}`} style={{ marginTop: ".8rem" }}>
              {opsResult}
            </p>
          )}
        </section>

        <section className="panel" style={{ gridColumn: "1 / -1" }}>
          <div className="panel-title">
            <h3>Endpoints this client uses</h3>
          </div>
          {ENDPOINTS.map((e) => (
            <div className="endpoint" key={`${e.verb} ${e.path}`}>
              <span className={`verb ${e.verb.toLowerCase()}`}>{e.verb}</span>
              <span style={{ color: "var(--text)" }}>{e.path}</span>
              <span className="spacer" />
              <span className="faint">{e.note}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
