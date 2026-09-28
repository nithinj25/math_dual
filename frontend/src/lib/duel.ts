/** Shape of a live duel as the client understands it.
 *  Every field is a cache of what the server last said — nothing here is
 *  computed locally except the timestamps we need to draw clocks. */

export const TOTAL_QUESTIONS = 20;   // tier_configs/*.json questionCount
export const MATCH_MS = 120_000;     // gateway duelRoom.ts MATCH_MS

export type Phase = "idle" | "queued" | "countdown" | "live" | "over";

export type Outcome = "hit" | "miss" | null;

export interface DuelState {
  matchId: string;
  opponent: string;
  tier: string;
  qIndex: number;
  prompt: string;
  shownAt: number;              // local clock when the question frame landed
  yourScore: number;
  oppScore: number;
  oppAt: number;                // questions the opponent has finished
  answered: number;             // result frames we have received
  outcomes: Outcome[];          // per question, from result frames
  solveMs: number[];            // local estimate, per answered question
  rejected: string | null;
  liveAt: number | null;        // local clock when the match goes live
  last: { qIndex: number; correct: boolean; at: number } | null;
}

export const EMPTY_DUEL: DuelState = {
  matchId: "",
  opponent: "",
  tier: "",
  qIndex: -1,
  prompt: "",
  shownAt: 0,
  yourScore: 0,
  oppScore: 0,
  oppAt: 0,
  answered: 0,
  outcomes: Array(TOTAL_QUESTIONS).fill(null),
  solveMs: [],
  rejected: null,
  liveAt: null,
  last: null,
};

export function accuracy(d: DuelState) {
  return d.answered === 0 ? 0 : d.yourScore / d.answered;
}

/** Current run of correct answers, read off the outcome list. */
export function streak(d: DuelState) {
  let n = 0;
  for (let i = d.answered - 1; i >= 0; i--) {
    if (d.outcomes[i] !== "hit") break;
    n++;
  }
  return n;
}
