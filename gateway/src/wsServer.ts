import { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { LocalMatch, Player } from "./duelRoom.js";
import { api, auth, mm, ApiError } from "./apiClient.js";
import { Envelope, subscribe, unsubscribe } from "./bus.js";

const HEARTBEAT_INTERVAL_MS = 10_000;
const POLL_INTERVAL_MS = 1_000;

export function startWsServer(port: number): WebSocketServer {
    const wss = new WebSocketServer({ port });

    // Everything here is about LOCAL sockets only. No game state, no queue,
    // no room membership — those all live in Redis now.
    const players = new Map<WebSocket, Player>();
    const byUser  = new Map<string, Player>();
    const matches = new Map<string, LocalMatch>();   // userId -> their match

    async function enterMatch(p: Player, room: any, resume: boolean) {
        const oppId = room.players.find((x: string) => x !== p.id)!;
        const oppName = room.names?.[oppId] ?? oppId.slice(0, 8);

        const lm = new LocalMatch(room.match_id, room.tier, p, oppId);
        matches.set(p.id, lm);
        p.matchId = room.match_id;

        // One handler per channel serves whichever of the two players we hold.
        await subscribe(room.match_id, (env: Envelope) => {
            matches.get(env.to)?.deliver(env.msg);
        });

        console.log(`[match] ${p.name} in ${room.match_id} vs ${oppName}` +
                    (resume ? " (resumed)" : ""));
        if (resume) await lm.resume(oppName);
        else await lm.start(oppName);
    }

    async function poll(p: Player, startedAt: number) {
        if (!byUser.has(p.id) || matches.has(p.id)) return;   // gone, or matched
        try {
            const r = await mm.join(p.id, (Date.now() - startedAt) / 1000);
            if (r.matched) return await enterMatch(p, r.room, false);
            p.socket.send(JSON.stringify({ t: "waiting", window: r.window }));
        } catch (err) {
            console.error("[mm]", err instanceof ApiError ? err.message : err);
        }
        setTimeout(() => poll(p, startedAt).catch(console.error), POLL_INTERVAL_MS);
    }

    wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
        console.log(`[open]  (${players.size + 1} here) from ${req.socket.remoteAddress}`);

        socket.on("pong", () => {
            const p = players.get(socket);
            if (p) matches.get(p.id)?.onPong().catch(console.error);
        });

        socket.on("message", async (data: Buffer) => {
            let msg: any;
            try { msg = JSON.parse(data.toString()); }
            catch { return socket.send(JSON.stringify({ t: "rejected", reason: "not JSON" })); }

            if (msg.t === "join") {
                if (players.has(socket)) return;

                let identity;
                try { identity = await auth.resolve(msg.token); }
                catch {
                    socket.send(JSON.stringify({ t: "rejected", reason: "invalid token" }));
                    return socket.close(4001, "unauthorized");
                }

                const p: Player = { id: identity.user_id, name: identity.username,
                                    socket, rttMs: 0, lastPingAt: Date.now() };
                players.set(socket, p);
                byUser.set(p.id, p);
                console.log(`[join] ${p.name}`);

                // Were they already mid-match? Any gateway can answer this.
                try {
                    const room = await api.myRoom(p.id);
                    return await enterMatch(p, room, true);
                } catch { /* 404: not in a match, so queue up */ }

                return await poll(p, Date.now());
            }

            if (msg.t === "answer") {
                const p = players.get(socket);
                const lm = p && matches.get(p.id);
                if (!p || !lm) {
                    return socket.send(JSON.stringify({ t: "rejected", reason: "not in a match" }));
                }
                return await lm.onAnswer({ qIndex: msg.qIndex, value: msg.value });
            }

            socket.send(JSON.stringify({ t: "rejected", reason: `unknown type ${msg.t}` }));
        });

        socket.on("close", async (code: number) => {
            const p = players.get(socket);
            players.delete(socket);
            if (!p) return;
            byUser.delete(p.id);
            matches.delete(p.id);
            if (p.matchId) await unsubscribe(p.matchId).catch(() => {});
            // Not in a match yet? Take them out of the queue.
            else await mm.leave(p.id, "intermediate").catch(() => {});
            console.log(`[close] ${p.name} code=${code} (${players.size} here)`);
        });

        socket.on("error", (err: Error) => console.error(`[error] ${err.message}`));
    });

    const heartbeat = setInterval(() => {
        for (const [socket, p] of players) {
            if (socket.readyState !== WebSocket.OPEN) continue;
            p.lastPingAt = Date.now();
            socket.ping();
        }
    }, HEARTBEAT_INTERVAL_MS);

    wss.on("close", () => clearInterval(heartbeat));
    console.log(`ws gateway listening on :${port}`);
    return wss;
}
