const API = process.env.API_URL ?? "http://127.0.0.1:8000";

export class ApiError extends Error {
    constructor(public status: number, message: string){
        super(message);
    }
}

async function callAbs(method: string, path: string, body?:unknown): Promise<any> {
    const res = await fetch(`${API}${path}`, {
        method,
        headers: { "Content-Type": "application/json"},
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if(!res.ok) throw new ApiError(res.status, data.detail ?? "api error");
    return data;
}

function call(method: string, path: string, body?:unknown): Promise<any> {
    return callAbs(method, `/internal/duels${path}`, body);
}

export const api = {
    create: (matchId: string, seed: number, tier: string, playerIds: string[]) =>
        call("POST", "",  {match_id: matchId, seed, tier, player_ids: playerIds, duration_seconds: 120}),
    countdown: (matchId: string) => call("POST", `/${matchId}/countdown`),
    tick: (matchId: string) => call("POST", `/${matchId}/tick`),
    question: (matchId: string, playerId: string) => call("GET", `/${matchId}/questions/${playerId}`),

    answer: (matchId: string, playerId: string, qIndex: number, value: number) => call("POST", `/${matchId}/answer`, { player_id: playerId, q_index: qIndex, value }),
    rtt: (matchId: string, playerId: string, rttMs: number) => 
        call("POST", `/${matchId}/rtt`, { player_id: playerId, rtt_ms: rttMs}),

    result: (matchId: string) => call("GET", `/${matchId}/result`),
    finalize: (matchId: string) => call("POST", `/${matchId}/finalize`),
    close: (matchId: string) => call("DELETE", `/${matchId}`),
};

export const auth = {
    resolve: (token: string) =>
        callAbs("POST", "/internal/auth/resolve", { token }),
};

