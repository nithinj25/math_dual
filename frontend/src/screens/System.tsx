import { useState } from "react";
import { motion } from "motion/react";
import { Copy, RotateCw, Search } from "lucide-react";

import {
  API_URL, ENDPOINTS, GATEWAY_URL, TIERS, health, myRoom, queueSize,
  rebuildBoard, room, snapshotBoard, type Me, type Room, type Tier,
} from "../lib/api";
import { usePolled } from "../lib/hooks";
import { title } from "../lib/format";
import type { Status } from "../lib/socket";
import { Badge, Bar, Button, Card, CardHead, Dot, Input, Segmented } from "../ui/primitives";
import { cx } from "../lib/cx";
import { Tip } from "../ui/Tooltip";

const VERB: Record<string, string> = {
  GET: "text-good bg-good/10",
  POST: "text-warn bg-warn/10",
  WS: "text-accent-hi bg-accent/10",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-line px-4 py-2 text-13 [&:not(:first-child)]:border-t">
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5 truncate text-ink-2">{children}</span>
    </div>
  );
}

export default function System({ me, ws }: { me: Me | null; ws: Status }) {
  const [matchId, setMatchId] = useState("");
  const [found, setFound] = useState<Room | null | "none">(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [opsTier, setOpsTier] = useState<Tier>("intermediate");
  const [opsScope, setOpsScope] = useState<"global" | "weekly">("global");
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
  const busiest = Math.max(1, ...(queues.data?.map((q) => q.waiting) ?? [1]));

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
    const weekly = opsScope === "weekly";
    setOpsBusy(true);
    setOpsResult(null);
    try {
      if (kind === "rebuild") {
        const r = await rebuildBoard(opsTier);
        setOpsResult(`rebuilt ${r.tier} from Postgres — ${r.players} players restored`);
      } else {
        const r = await snapshotBoard(opsTier, weekly);
        setOpsResult(
          `snapshotted ${r.tier} (${weekly ? "weekly" : "global"}) — ${r.rows} rows written`,
        );
      }
    } catch (e) {
      setOpsResult(`failed: ${(e as Error).message}`);
    } finally {
      setOpsBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6">
      <div>
        <h1 className="text-2xl">System</h1>
        <p className="mt-1 max-w-[62ch] text-13 text-ink-2">
          Everything this client can see of the running stack — and every endpoint it uses.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Services"
            right={
              <Badge tone={ping.error ? "bad" : ping.data ? "good" : "neutral"}>
                {ping.error ? "degraded" : ping.data ? "healthy" : "checking"}
              </Badge>
            }
          />
          <div>
            <Row label="api">
              <Dot tone={ping.error ? "off" : ping.data ? "on" : "warn"} />
              {ping.error
                ? "unreachable"
                : ping.data
                  ? `${ping.data.status} · ${ping.data.ms}ms`
                  : "checking…"}
            </Row>
            <Row label="api url">
              <span className="truncate font-mono text-11">{API_URL}</span>
            </Row>
            <Row label="gateway socket">
              <Dot tone={ws === "open" ? "on" : ws === "connecting" ? "warn" : ws === "idle" ? "idle" : "off"} />
              {ws}
            </Row>
            <Row label="gateway url">
              <span className="truncate font-mono text-11">{GATEWAY_URL}</span>
            </Row>
            <Row label="your users.id">
              <span className="truncate font-mono text-11">{me?.id ?? "—"}</span>
              {me && (
                <Tip label="copy">
                  <button
                    onClick={() => navigator.clipboard?.writeText(me.id)}
                    className="text-ink-3 transition-colors hover:text-ink-2"
                    aria-label="Copy user id"
                  >
                    <Copy size={12} />
                  </button>
                </Tip>
              )}
            </Row>
          </div>
          {ping.error && (
            <p className="border-t border-line bg-bad/10 px-4 py-2 text-13 text-bad">
              {ping.error}
            </p>
          )}
        </Card>

        <Card>
          <CardHead
            title="Matchmaking queues"
            right={
              <Button variant="ghost" size="sm" onClick={queues.refresh} aria-label="Refresh queues">
                <RotateCw size={12} className={cx(queues.loading && "animate-spin")} />
              </Button>
            }
          />
          <div className="p-1.5">
            {TIERS.map((t, i) => (
              <div key={t} className="rounded-md px-2.5 py-2 hover:bg-panel-hi">
                <div className="flex items-baseline justify-between gap-3 text-13">
                  <span className="capitalize text-ink">{t}</span>
                  <span className="tnum text-ink-2">
                    {queues.data ? `${queues.data[i].waiting} waiting` : "—"}
                  </span>
                </div>
                <Bar
                  value={(queues.data?.[i].waiting ?? 0) / busiest}
                  tone={i === 2 ? "them" : "accent"}
                  className="mt-1.5"
                />
              </div>
            ))}
          </div>
          <p className="border-t border-line px-4 py-2.5 text-11 leading-relaxed text-ink-3">
            A Redis sorted set per tier, scored by rating. Pairing is one atomic Lua call,
            so two callers can never claim the same opponent.
          </p>
        </Card>

        <Card>
          <CardHead title="Room inspector" />
          <div className="flex flex-col gap-2 p-3">
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="m_1a2b3c4d"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && lookup(matchId)}
              />
              <Button onClick={() => lookup(matchId)} disabled={!matchId.trim()}>
                <Search size={12} /> Look up
              </Button>
            </div>
            <Button variant="ghost" size="sm" className="self-start" onClick={lookupMine} disabled={!me}>
              My current room
            </Button>

            {lookupError && (
              <p className="rounded-md border border-bad/30 bg-bad/10 px-2.5 py-1.5 text-13 text-bad">
                {lookupError}
              </p>
            )}
            {found === "none" && (
              <p className="text-13 text-ink-3">
                No such room. Rooms live in Redis for ten minutes after the match.
              </p>
            )}
            {found && found !== "none" && (
              <motion.pre
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-h-64 overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-11 leading-relaxed text-ink-2"
              >
                {JSON.stringify(found, null, 2)}
              </motion.pre>
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Board maintenance" />
          <div className="flex flex-col gap-3 p-3">
            <p className="text-13 text-ink-2">
              Operational endpoints. Rebuild recomputes a global board from the rated
              matches in Postgres; snapshot writes the current board into
              leaderboard_snapshots.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={opsTier}
                onChange={setOpsTier}
                options={TIERS.map((t) => ({ value: t, label: title(t) }))}
              />
              <Segmented
                value={opsScope}
                onChange={setOpsScope}
                options={[
                  { value: "global", label: "Global" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => runOp("rebuild")} disabled={opsBusy}>
                Rebuild from Postgres
              </Button>
              <Button onClick={() => runOp("snapshot")} disabled={opsBusy}>
                Take snapshot
              </Button>
            </div>
            {opsResult && (
              <p
                className={cx(
                  "rounded-md border px-2.5 py-1.5 text-13",
                  opsResult.startsWith("failed")
                    ? "border-bad/30 bg-bad/10 text-bad"
                    : "border-good/30 bg-good/10 text-good",
                )}
              >
                {opsResult}
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Endpoints this client uses"
          right={<span className="text-11 text-ink-3">{ENDPOINTS.length} total</span>}
        />
        <div>
          {ENDPOINTS.map((e) => (
            <div
              key={`${e.verb} ${e.path}`}
              className="flex items-center gap-3 border-line px-4 py-2 text-13 hover:bg-panel-hi [&:not(:first-child)]:border-t"
            >
              <span
                className={cx(
                  "w-11 shrink-0 rounded text-center font-mono text-[10px] leading-5",
                  VERB[e.verb],
                )}
              >
                {e.verb}
              </span>
              <span className="truncate font-mono text-11 text-ink">{e.path}</span>
              <span className="flex-1" />
              <span className="hidden truncate text-11 text-ink-3 sm:block">{e.note}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
