import { WebSocket } from "ws";
import { api, ApiError } from "./apiClient.js";
import { publish } from "./bus.js";

export interface Player {
    id: string;          // real users.id UUID
    name: string;        // display name
    socket: WebSocket;
    rttMs: number;
    lastPingAt: number;
    matchId?: string;
}

const MATCH_MS = 120_000;

/** Drives ONE local player through ONE match. The opponent may be on
 *  another gateway entirely; we never touch their socket, only the bus. */
export class LocalMatch {
    private ended = false;

    constructor(
        public matchId: string,
        public tier: string,
        private me: Player,
        private opponentId: string,
    ) {}

    private send(msg: object) {
        if (this.me.socket.readyState === WebSocket.OPEN) {
            this.me.socket.send(JSON.stringify(msg));
        }
    }

    async start(opponentName: string) {
        this.send({ t: "matched", matchId: this.matchId,
                    opponent: { name: opponentName }, tier: this.tier });

        // Both gateways call this. The state machine rejects the second
        // with 409, which is exactly the behaviour we want.
        let startsIn = 3000;
        try {
            const r = await api.countdown(this.matchId);
            startsIn = r.starts_in_ms;
        } catch (err) {
            if (!(err instanceof ApiError)) throw err;   // 409 = already counting
        }
        this.send({ t: "countdown", startsInMs: startsIn });

        setTimeout(() => this.goLive().catch(console.error), startsIn);
        setTimeout(() => this.timeUp().catch(console.error), startsIn + MATCH_MS + 1000);
    }

    private async goLive() {
        try { await api.tick(this.matchId); } catch { /* other gateway did it */ }
        await this.serve();
    }

    /** Ask the API for our next question and send it down. */
    private async serve() {
        if (this.ended) return;
        const q = await api.question(this.matchId, this.me.id);
        if (q.done) return;                       // wait for the opponent
        this.send({ t: "question", qIndex: q.q_index,
                    prompt: q.prompt, servedTs: q.served_ts });
    }

    async onAnswer(msg: { qIndex: number; value: number }) {
        try {
            const r = await api.answer(this.matchId, this.me.id, msg.qIndex, msg.value);
            this.send({ t: "result", qIndex: msg.qIndex, correct: r.correct,
                        yourScore: r.scores[this.me.id],
                        oppScore: r.scores[this.opponentId] });

            // tell the opponent, wherever they are
            await publish(this.matchId, {
                to: this.opponentId,
                msg: { t: "opp", qIndex: msg.qIndex, oppAnswered: true },
            });

            if (r.status === "finished") return this.concludeForEveryone();
            await this.serve();
        } catch (err) {
            if (err instanceof ApiError) {
                this.send({ t: "rejected", reason: err.message });
                await this.serve();               // never strand the player
            } else throw err;
        }
    }

    private async timeUp() {
        if (this.ended) return;
        try { await api.tick(this.matchId); } catch { /* ignore */ }
        await this.concludeForEveryone();
    }

    /** Whichever gateway notices the match is over rates it and publishes
     *  an "end" for BOTH players. Our own copy comes back over the bus. */
    private async concludeForEveryone() {
        if (this.ended) return;
        this.ended = true;

        const deltas: Record<string, number> = {};
        try {
            const fin = await api.finalize(this.matchId);
            for (const id of [this.me.id, this.opponentId]) {
                deltas[id] = Math.round(fin[id]?.delta ?? 0);
            }
        } catch (err) {
            // 409 = the other gateway rated it first. Not a problem.
            if (!(err instanceof ApiError)) console.error("[finalize]", err);
        }

        try {
            const r = await api.result(this.matchId);
            for (const id of [this.me.id, this.opponentId]) {
                const other = id === this.me.id ? this.opponentId : this.me.id;
                await publish(this.matchId, {
                    to: id,
                    msg: { t: "end",
                           winner: r.winner === null ? "draw"
                                 : (r.winner === id ? "you" : "them"),
                           score: [r.scores[id], r.scores[other]],
                           ratingDelta: deltas[id] ?? 0 },
                });
            }
        } catch (err) {
            console.error(`[conclude] ${this.matchId}`, err);
        }

        await api.close(this.matchId).catch(() => {});
    }

    async onPong() {
        if (this.ended) return;
        this.me.rttMs = Date.now() - this.me.lastPingAt;
        await api.rtt(this.matchId, this.me.id, this.me.rttMs).catch(() => {});
    }

    /** Reconnection: put the player back where they were. */
    async resume(opponentName: string) {
        this.send({ t: "matched", matchId: this.matchId,
                    opponent: { name: opponentName }, tier: this.tier });
        await this.serve();
    }

    deliver(msg: object) {   // something arrived on the bus for us
        this.send(msg);
    }
}
