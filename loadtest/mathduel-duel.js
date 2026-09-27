// One virtual user = one player: load the app, open a socket, queue up, get
// paired by the real matchmaker, answer twenty questions with human-ish think
// time, receive the end frame, then loop into another duel.
//
//   k6 run -e BASE_URL=https://staging.mathduel.me \
//          -e WS_URL=wss://staging.mathduel.me/ws \
//          loadtest/mathduel-duel.js
//
// Needs k6 >= 1.0 for k6/websockets. Requires tokens.json alongside this file
// (see mint-tokens.mjs) with at least as many tokens as peak VUs.

import http from "k6/http";
import { sleep } from "k6";
import { WebSocket } from "k6/websockets";
import { setTimeout, clearTimeout } from "k6/timers";
import { Trend, Rate, Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL || "http://localhost:8000";
const WS_URL = __ENV.WS_URL || "ws://localhost:8080";

// Wrong-answer rate. Deliberately non-zero so losses, and therefore Glicko-2
// updates in both directions, are exercised rather than only the win path.
const WRONG_RATE = Number(__ENV.WRONG_RATE || "0.15");

const THINK_MIN_MS = Number(__ENV.THINK_MIN_MS || "1500");
const THINK_MAX_MS = Number(__ENV.THINK_MAX_MS || "4000");

// 20 questions per duel at ~2.75s each is ~55s of thinking, inside the
// server's 120s match limit. Plus countdown and queue wait, 180s is a
// generous ceiling: anything slower is a real failure, not slow bots.
const WATCHDOG_MS = Number(__ENV.WATCHDOG_MS || "180000");

// Real players do not all arrive at once, and they pause before queueing
// again. Without this every VU finishes its duel at the same instant and
// re-queues in lockstep, so whoever is left unpaired waits a whole duel
// for a partner -- an artifact of a small synchronised population rather
// than anything the server did.
const JOIN_JITTER_S = Number(__ENV.JOIN_JITTER_S || "5");

const tokens = new SharedArray("tokens", () => JSON.parse(open("./tokens.json")));

const matchWait = new Trend("match_wait_ms", true); // join sent -> matched
const answerRtt = new Trend("answer_rtt_ms", true); // answer sent -> result
const wsConnect = new Trend("ws_connect_ms", true);
const duelLength = new Trend("duel_duration_ms", true);
const answersSent = new Counter("answers_sent");
const duelsDone = new Counter("duels_completed");
const rejects = new Counter("frames_rejected"); // server said no — protocol bug
const duelFailed = new Rate("duel_failed"); // watchdog, socket error, early close

export const options = {
  scenarios: {
    players: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 25 },
        { duration: "2m", target: 50 },
        { duration: "2m", target: 100 },
        { duration: "2m", target: 200 },
        { duration: "2m", target: 400 },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "90s",
    },
  },
  // Capacity is the highest VU count at which all of these still pass.
  thresholds: {
    answer_rtt_ms: ["p(95)<150", "p(99)<400"],
    match_wait_ms: ["p(95)<5000"],
    ws_connect_ms: ["p(95)<1000"],
    duel_failed: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300"],
  },
};

// Per-VU module state: a real player loads their profile and the leaderboard
// once on arrival, not before every duel.
let bootstrapped = false;

export default function () {
  const token = tokens[(__VU - 1) % tokens.length];

  if (!bootstrapped) {
    bootstrapped = true;
    const headers = { Authorization: `Bearer ${token}` };
    http.get(`${BASE}/api/me`, { headers, tags: { name: "me" } });
    http.get(`${BASE}/api/leaderboard/intermediate`, {
      headers,
      tags: { name: "leaderboard" },
    });
  }

  sleep(Math.random() * JOIN_JITTER_S);
  playOneDuel(token);
}

function playOneDuel(token) {
  const connectStartedAt = Date.now();
  let joinedAt = 0;
  let matchedAt = 0;
  let answerSentAt = 0;
  let settled = false;
  // Tracked so it can be cancelled: a think timer still pending when the
  // test ends makes k6 log a warning per VU, which buries the summary.
  let thinkTimer;

  const ws = new WebSocket(WS_URL);

  const finish = (failed) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    clearTimeout(thinkTimer);
    duelFailed.add(failed ? 1 : 0);
    if (!failed) {
      duelsDone.add(1);
      if (matchedAt) duelLength.add(Date.now() - matchedAt);
    }
    try {
      ws.close();
    } catch (_) {
      /* already closing */
    }
  };

  const watchdog = setTimeout(() => finish(true), WATCHDOG_MS);

  ws.onopen = () => {
    wsConnect.add(Date.now() - connectStartedAt);
    joinedAt = Date.now();
    // Queueing is implicit: joining IS entering the queue. There is no
    // separate queue message, and the token travels in this frame rather
    // than a query parameter.
    ws.send(JSON.stringify({ t: "join", token }));
  };

  ws.onmessage = (e) => {
    if (settled) return;

    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch (_) {
      return;
    }

    switch (msg.t) {
      case "waiting":
        // Still queued; the gateway re-polls matchmaking once a second.
        break;

      case "matched":
        matchedAt = Date.now();
        matchWait.add(matchedAt - joinedAt);
        break;

      case "countdown":
        // Questions start arriving after startsInMs. Nothing to send.
        break;

      case "question": {
        const value = answerFor(msg.prompt);
        const think = THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS);
        thinkTimer = setTimeout(() => {
          if (settled) return;
          answerSentAt = Date.now();
          ws.send(JSON.stringify({ t: "answer", qIndex: msg.qIndex, value }));
          answersSent.add(1);
        }, think);
        break;
      }

      case "result":
        if (answerSentAt) answerRtt.add(Date.now() - answerSentAt);
        break;

      case "opp":
        // The opponent answered. Purely informational for the UI.
        break;

      case "rejected":
        // The server refused something we sent. Under load this is usually a
        // stale qIndex after a timeout; anything else means the script and
        // the protocol have drifted apart.
        rejects.add(1);
        break;

      case "end":
        finish(false);
        break;
    }
  };

  ws.onerror = () => finish(true);
  ws.onclose = () => finish(!settled);
}

// The server is authoritative and never sends the answer, so the bot solves
// the prompt itself. Five templates, all exactly parseable — division is
// always exact and percentages always land on a whole number by construction
// (see api/modules/questions/templates.py).
function solve(prompt) {
  const p = String(prompt).trim();
  let m;
  if ((m = p.match(/^(\d+)\s*\+\s*(\d+)$/))) return Number(m[1]) + Number(m[2]);
  if ((m = p.match(/^(\d+)\s*-\s*(\d+)$/))) return Number(m[1]) - Number(m[2]);
  if ((m = p.match(/^(\d+)\s*×\s*(\d+)$/))) return Number(m[1]) * Number(m[2]);
  if ((m = p.match(/^(\d+)\s*÷\s*(\d+)$/))) return Number(m[1]) / Number(m[2]);
  if ((m = p.match(/^(\d+)²$/))) return Number(m[1]) * Number(m[1]);
  if ((m = p.match(/^(\d+)%\s*of\s*(\d+)$/)))
    return Math.floor((Number(m[2]) * Number(m[1])) / 100);
  return null;
}

function answerFor(prompt) {
  const correct = solve(prompt);
  // An unparseable prompt means the generator grew a template this script
  // does not know. Send something deliberately wrong rather than crashing,
  // and let frames_rejected / a low score surface it.
  if (correct === null) return -1;
  return Math.random() < WRONG_RATE ? correct + 1 : correct;
}
