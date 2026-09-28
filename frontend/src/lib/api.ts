/** Every HTTP endpoint the MathDuel API exposes to a browser, in one place.
 *  Each call is announced to onApiCall subscribers so the protocol drawer can
 *  show the real traffic instead of a summary of it. */

const API = (import.meta.env.VITE_API_URL as string) ?? "http://127.0.0.1:8000";

export const API_URL = API;
export const GATEWAY_URL =
  (import.meta.env.VITE_GATEWAY_URL as string) ?? "ws://127.0.0.1:8080";

export type Tier = "beginner" | "intermediate" | "advanced";
export const TIERS: Tier[] = ["beginner", "intermediate", "advanced"];

/** Straight from api/modules/matchmaking/tiers.py — shown, never enforced here. */
export const TIER_BANDS: Record<Tier, string> = {
  beginner: "under 1200",
  intermediate: "1200 – 1799",
  advanced: "1800 and up",
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiCall {
  id: number;
  method: string;
  path: string;
  status: number;
  ms: number;
  at: number;
  ok: boolean;
}

type CallListener = (call: ApiCall) => void;
const listeners = new Set<CallListener>();
let callSeq = 0;

export function onApiCall(fn: CallListener) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

async function req<T>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<T> {
  const started = performance.now();
  let status = 0;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...(opts.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    status = res.status;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, String(data?.detail ?? `${res.status} ${res.statusText}`));
    }
    return data as T;
  } finally {
    const call: ApiCall = {
      id: ++callSeq,
      method,
      path,
      status,
      ms: Math.round(performance.now() - started),
      at: Date.now(),
      ok: status >= 200 && status < 300,
    };
    for (const fn of listeners) fn(call);
  }
}

/** 404 is a legitimate answer for several endpoints ("not ranked", "no room"). */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// --- types the API returns -------------------------------------------------

export interface Me {
  id: string;
  username: string;
  email: string | null;
  auth_provider: string;
  provider_subject: string;
  created_at: string;
}

export interface BoardEntry {
  rank: number;
  user_id: string;
  points: number;
}

export interface Board {
  tier: string;
  scope: string;
  entries: BoardEntry[];
}

export interface Standing {
  tier: string;
  user_id: string;
  rank: number;
  points: number;
  of: number;
}

export interface Room {
  match_id: string;
  tier: string;
  seed: number;
  status: string;
  players: string[];
  names: Record<string, string>;
}

// --- endpoints -------------------------------------------------------------

/** GET /health */
export const health = () => req<{ status: string }>("GET", "/health");

/** GET /me — resolves the Supabase token to this API's own users row.
 *  That row's id, not the Supabase uid, is what the leaderboard is keyed by. */
export const me = (token: string) => req<Me>("GET", "/me", { token });

/** GET /leaderboard/{tier} */
export const board = (tier: Tier, weekly = false, limit = 20) =>
  req<Board>("GET", `/leaderboard/${tier}?limit=${limit}&weekly=${weekly}`);

/** GET /leaderboard/{tier}/rank/{user_id} — null when the player is unranked. */
export const standing = (tier: Tier, userId: string, weekly = false) =>
  orNull(req<Standing>("GET", `/leaderboard/${tier}/rank/${userId}?weekly=${weekly}`));

/** POST /leaderboard/{tier}/rebuild — recompute the global board from Postgres. */
export const rebuildBoard = (tier: Tier) =>
  req<{ tier: string; players: number }>("POST", `/leaderboard/${tier}/rebuild`);

/** POST /leaderboard/{tier}/snapshot — persist the current board. */
export const snapshotBoard = (tier: Tier, weekly = false) =>
  req<{ tier: string; rows: number }>("POST", `/leaderboard/${tier}/snapshot?weekly=${weekly}`);

/** GET /internal/matchmaking/size/{tier} */
export const queueSize = (tier: Tier) =>
  req<{ tier: string; waiting: number }>("GET", `/internal/matchmaking/size/${tier}`);

/** GET /internal/duels/rooms/by-player/{user_id} — null when not in a match. */
export const myRoom = (userId: string) =>
  orNull(req<Room>("GET", `/internal/duels/rooms/by-player/${userId}`));

/** GET /internal/duels/rooms/{match_id} — null when the room has expired. */
export const room = (matchId: string) =>
  orNull(req<Room>("GET", `/internal/duels/rooms/${matchId}`));

/** Reference list for the System screen: what this UI talks to, and why. */
export const ENDPOINTS: { verb: "GET" | "POST" | "WS"; path: string; note: string }[] = [
  { verb: "GET", path: "/health", note: "liveness dot in the header" },
  { verb: "GET", path: "/me", note: "identity + the users.id everything is keyed by" },
  { verb: "GET", path: "/leaderboard/{tier}", note: "the board, global or weekly" },
  { verb: "GET", path: "/leaderboard/{tier}/rank/{user}", note: "your standing" },
  { verb: "POST", path: "/leaderboard/{tier}/rebuild", note: "recompute from Postgres" },
  { verb: "POST", path: "/leaderboard/{tier}/snapshot", note: "persist the board" },
  { verb: "GET", path: "/internal/matchmaking/size/{tier}", note: "players queued per tier" },
  { verb: "GET", path: "/internal/duels/rooms/by-player/{user}", note: "resume a live match" },
  { verb: "GET", path: "/internal/duels/rooms/{match}", note: "room inspector" },
  { verb: "WS", path: "gateway /", note: "join, answer — and the eight server frames" },
];
