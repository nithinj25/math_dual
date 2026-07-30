import { WebSocket } from "ws";
import { api, ApiError } from "./apiClient.js";

export interface Player {
    id: string;          // real users.id UUID
    name: string;        // display name
    socket: WebSocket;
    rttMs: number;
    lastPingAt: number;
}

const TIER = "intermediate";
const MATCH_MS = 120_000;

export class DuelRoom {
    private ended = false;
    private finished = new Set<string>();

    constructor(public matchId: string, private players: Player[]){}

    private send(p : Player, msg: object){
        if(p.socket.readyState === WebSocket.OPEN) p.socket.send(JSON.stringify(msg));
    }

    private other(p: Player): Player {
        return this.players.find((x) => x.id != p.id)!;
    }

    async start() {
        const seed = Math.floor(Math.random() * 2 ** 31);
        await api.create(this.matchId, seed, TIER, this.players.map((p) => p.id));

        for(const p of this.players){
            this.send(p, { t: "matched", matchId: this.matchId, opponent: { name: this.other(p).name }, tier: TIER});
        }

        const { starts_in_ms } = await api.countdown(this.matchId);
        for(const p of this.players){
            this.send(p, { t: "countdown", startsInMs: starts_in_ms});
        }

        setTimeout(() => this.goLive().catch(console.error), starts_in_ms);
    }

    private async goLive() {
        await api.tick(this.matchId);              // countdown -> live
        // timed from the real go-live moment, with slack for clock/RTT slop
        setTimeout(() => this.finish().catch(console.error), MATCH_MS + 1000);
        for(const p of this.players) await this.serve(p);
    }

    private async serve(p: Player) {
        if(this.ended) return;
        const q = await api.question(this.matchId, p.id);
        if(q.done){
            this.finished.add(p.id);
            if(this.finished.size === this.players.length) await this.finish();
            return;
        }
        this.send(p, { t: "question", qIndex: q.q_index, prompt: q.prompt, servedTs: q.served_ts });
    }

    async onAnswer(p: Player, msg: { qIndex: number; value: number }) {
        try {
            const r = await api.answer(this.matchId, p.id, msg.qIndex, msg.value);
            const opp = this.other(p);
            this.send(p, { t: "result", qIndex: msg.qIndex, correct: r.correct,
                           yourScore: r.scores[p.id], oppScore: r.scores[opp.id] });
            this.send(opp, { t: "opp", qIndex: msg.qIndex, oppAnswered: true });
            await this.serve(p);
        } catch (err) {
            if (err instanceof ApiError) {
                this.send(p, { t: "rejected", reason: err.message });   // cheat / bad state
                await this.serve(p);        // re-send their real question, don't strand them
            } else throw err;
        }
    }

    async onPong(p: Player) {
        if(this.ended) return;             // match over; stop reporting RTT
        p.rttMs = Date.now() - p.lastPingAt;
        await api.rtt(this.matchId, p.id, p.rttMs).catch(() => {});
    }

    async finish() {
        if(this.ended) return;
        this.ended = true;
        try {
            await api.tick(this.matchId);
            const r = await api.result(this.matchId);

            // rate the match before the duel is evicted
            const deltas: Record<string, number> = {};
            try {
                const fin = await api.finalize(this.matchId);
                for(const p of this.players) deltas[p.id] = Math.round(fin[p.id]?.delta ?? 0);
            } catch (err) {
                const why = err instanceof ApiError ? err.message : String(err);
                console.error(`[finalize] ${this.matchId}: ${why}`);   // match still ends
            }

            for(const p of this.players){
                this.send(p, { t: "end",
                               winner: r.winner === null ? "draw" : (r.winner === p.id ? "you" : "them"),
                               score: [r.scores[p.id], r.scores[this.other(p).id]],
                               ratingDelta: deltas[p.id] ?? 0 });
            }
        } catch (err) {
            const reason = err instanceof ApiError ? err.message : String(err);
            console.error(`[finish] ${this.matchId}: ${reason}`);
            for(const p of this.players){
                this.send(p, { t: "end", winner: "draw", score: [0, 0], ratingDelta: 0 });
            }
        } finally {
            await api.close(this.matchId).catch(() => {});
        }
    }
}
