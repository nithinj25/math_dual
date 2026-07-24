# MathDuel — System Design Document
### A Matiks-style real-time competitive mental math platform

Version 1.0 · July 2026

---

## 1. Overview

MathDuel is a real-time 1v1 mental math dueling platform. Two players at the same difficulty tier receive an identical sequence of questions and race to answer them; the winner gains rating, matches feed leaderboards, and an AI coach analyzes every ranked game to deliver personalized technique recommendations and targeted practice drills.

The system is designed around four principles. First, the server is the single source of truth: clients are untrusted input devices, and all correctness, timing, and scoring decisions happen server-side. Second, the hot path (everything between "match found" and "match finished") touches only in-memory infrastructure — no relational database sits on the per-answer path. Third, durable facts flow through an event log, decoupling gameplay from analytics, coaching, and anti-cheat. Fourth, every completed match is reproducible from a single 64-bit seed.

### 1.1 Functional requirements

The platform supports account creation and profiles; ranked matchmaking within a tier (beginner / intermediate / advanced) and a rating window; real-time duels of 20 questions or 90 seconds, whichever ends first; deterministic, identical question sequences for both players; server-side answer validation with latency-fair scoring; Glicko-2 ratings per tier; global and weekly leaderboards; post-game AI analysis with technique recommendations drawn from a curated library; coach-generated targeted drills; and bot opponents that backfill matchmaking when the player queue is thin.

### 1.2 Non-functional requirements

Server-side answer processing budget under 20 ms so total perceived round trip stays under ~150 ms on a typical mobile connection. The realtime tier must scale horizontally by adding gateway instances with no routing changes. Completed ranked matches must never be lost (durability boundary: Postgres commit). Analytics and AI workloads must be fully isolated from gameplay latency. A single developer must be able to run the entire stack locally via docker-compose.

### 1.3 Design-target scale (back-of-envelope)

Assume 10,000 DAU, each playing 5 matches per day: 25,000 matches/day. Each match produces ~20 questions × 2 players = 40 answer events plus ~10 lifecycle events ≈ 50 events, giving ~1.25M events/day ≈ 15 events/sec average, ~150/sec at peak (10× factor). At ~200 bytes/event that is ~250 MB/day of raw events (~10 GB/year in ClickHouse after 10–20× columnar compression). Postgres accumulates ~9M match rows/year — comfortably a single-node workload. Peak concurrency at 5% of DAU is ~500 simultaneous connections; a single Node gateway handles tens of thousands, so two instances exist for redundancy, not capacity. These numbers justify the architecture without over-building: the design scales 100× before any component needs replacing.

---

## 2. High-level architecture

```
                          ┌────────────────────────┐
                          │   Web / mobile client  │
                          └───────────┬────────────┘
                      HTTPS (REST)    │    WSS (live duels)
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
       ┌───────────────┐                          ┌─────────────────────┐
       │   REST API    │                          │  WS gateways (×N)   │
       │   (FastAPI)   │                          │      (Node.js)      │
       └───────┬───────┘                          └──────────┬──────────┘
               │          modular monolith core              │
       ┌───────┴──────────────────────────────────┬──────────┘
       ▼                                          ▼
  ┌─────────────┐   ┌──────────────┐   ┌────────────────┐   ┌──────────────────┐
  │ Matchmaking │   │ Game engine  │   │Question service│   │      Redis       │
  │ (ZSET+Lua)  │   │(authoritative│   │ (seeded gen +  │   │ rooms · pub/sub  │
  │             │   │state machine)│   │  tier configs) │   │ queues · boards  │
  └─────────────┘   └──────┬───────┘   └────────────────┘   └──────────────────┘
                           │ append events
                           ▼
                  ┌─────────────────┐
                  │      Kafka      │──────────► ClickHouse (analytics)
                  │  (event log)    │──────────► Coach worker ─► LLM ─► reports
                  └─────────────────┘──────────► Bot service (solve-time models)
                           │
                           ▼ match finalization
                  ┌─────────────────┐
                  │    Postgres     │  users · matches · ratings · configs
                  └─────────────────┘
```

The core ships as a modular monolith — matchmaking, game engine, question service, and ratings are separate modules with defined interfaces inside one deployable — with two independently scaled satellites: the WebSocket gateway tier (scales on connection count) and the async worker tier (scales on event throughput). Services are extracted when a scaling or organizational reason appears, not preemptively.

---

## 3. Core subsystems

### 3.0 Identity (delegated)

Authentication is delegated to a managed OIDC provider (Supabase Auth; Google as the primary social provider). The platform stores no credentials — no password hashes, no reset tokens, no verification flows — which removes the highest-risk, lowest-differentiation subsystem from the codebase entirely.

Three things remain in-house. First, **identity mapping**: the `users` table binds `(auth_provider, provider_subject)` to an internal UUID, and every other table references only that UUID, so provider migration is a one-table change rather than a schema-wide one. Second, **token verification**: the provider signs ID tokens with a private key and publishes the public key at a JWKS endpoint, which the REST API and every gateway fetch once and cache — verification is therefore local, with no per-request call to the provider, preserving the stateless property the gateway tier depends on (§6.2). Third, **authorization state**: a Redis set of banned user IDs is checked on every WS `join`, keeping account enforcement under platform control and independent of the provider's session lifecycle.

Failure mode: a provider outage blocks *new* logins while existing tokens continue to verify locally until expiry — degraded, not down. Verification sits behind an interface with a fake implementation used by integration tests and k6 load scripts (§8), so no test or benchmark depends on an external service.

### 3.1 REST API (FastAPI)

Handles everything that is not a live duel: identity callback handling, profile and match history reads, leaderboard pages, coach report retrieval, and drill session creation. All endpoints are stateless and horizontally scalable behind the load balancer. Representative surface:

```
GET  /auth/callback          POST /auth/session      (provider code exchange)
GET  /me                     GET  /users/{id}/profile
GET  /users/{id}/matches?cursor=...
GET  /leaderboard/{tier}?scope=global|weekly
GET  /matches/{id}/report            (coach output)
POST /practice/drills                (body: drill config from a coach report)
```

### 3.2 Real-time duel protocol

Each match is an explicit server-side state machine:

```
matched ──► countdown ──► live ──► finished ──► rated
                            │
                            └──► abandoned (disconnect timeout / forfeit)
```

Every inbound message is validated against the current state; an answer during `countdown` or a rematch request during `live` is rejected. The full room state lives in a Redis hash (see §4.2), never in gateway process memory, which is what makes gateways stateless and crashes survivable.

Message schema (JSON over WSS):

```jsonc
// client → server
{ "t": "join",   "matchId": "m_9f2c", "token": "<jwt>" }
{ "t": "answer", "matchId": "m_9f2c", "qIndex": 7, "value": 282, "clientTs": 1721489 }
{ "t": "ping",   "ts": 1721489 }

// server → client
{ "t": "matched",   "matchId": "m_9f2c", "opponent": {"name":"...", "rating": 1240}, "tier": "intermediate" }
{ "t": "countdown", "startsInMs": 3000 }
{ "t": "question",  "qIndex": 7, "prompt": "47 × 6", "servedTs": 1721480 }   // no answer field, ever
{ "t": "result",    "qIndex": 7, "correct": true, "yourScore": 8, "oppScore": 6 }
{ "t": "opp",       "qIndex": 7, "oppAnswered": true }
{ "t": "end",       "winner": "you", "score": [14, 11], "ratingDelta": +18 }
```

Latency fairness: the server records `servedTs` per connection when a question is dispatched and measures each player's RTT via periodic pings. Scoring uses estimated solve time (`arrivalTs − servedTs`, optionally minus RTT/2) rather than raw arrival order, so a 40 ms network advantage does not decide matches. Reconnection: a dropped client reconnects to any gateway with its JWT and matchId; the gateway reads the room hash from Redis and resumes mid-match. A player absent beyond 15 s forfeits.

### 3.3 Question service — tiers and seeded generation

A difficulty tier is a generator config: templates, parameter ranges, and sampling weights. Difficulty is a property of parameter buckets (e.g. "2-digit + 2-digit, with carry"), assigned initially by a feature heuristic (operation type, digit count, carry/borrow required, step count) and re-sortable later from empirical accuracy data in ClickHouse.

```jsonc
// tier_configs.intermediate (v3)
{
  "questionCount": 20,
  "buckets": [
    { "template": "add_sub",  "digits": [2,2], "carryRequired": true,  "weight": 0.30 },
    { "template": "multiply", "digits": [2,1],                          "weight": 0.25 },
    { "template": "divide",   "divisorDigits": 1, "exact": true,        "weight": 0.15 },
    { "template": "square",   "max": 20,                                "weight": 0.15 },
    { "template": "percent",  "ofRound": true,                          "weight": 0.15 }
  ],
  "ramp": "easyThirdFirst"   // within-match difficulty ordering
}
```

At match start the server draws one 64-bit seed. Questions derive deterministically from (seed, tier config version): both players provably see identical questions with zero coordination, the client is sent prompts with no answer payloads, the server re-derives answers on demand, and the entire match replays from one integer plus a config version — which is why `tier_config_version` is stored on every match row. A coach-generated drill is the same data structure with weights biased toward a user's weak buckets; practice mode therefore reuses the duel machinery wholesale.

### 3.4 Matchmaking

Waiting players sit in a Redis sorted set per tier, scored by rating. Pairing runs as a Lua script (atomic in Redis) that finds a candidate inside the searcher's window and removes both entries in one step, eliminating the double-match race between matchmaker instances. The window starts at ±50 rating and widens by 50 every 3 seconds of waiting — an explicit quality-versus-speed tradeoff tuned toward speed while the player base is small. If no human is found within 10 s, a bot with a matching target rating is injected (§5.2), which solves the liquidity problem the same way market makers solve it in an order book.

### 3.5 Ratings — Glicko-2

Each (user, tier) pair carries rating (initial 1500), rating deviation (initial 350), and volatility (initial 0.06, τ = 0.5). RD is what Elo lacks: new or returning players carry high uncertainty and converge in a handful of games, while established ratings resist noise. Updates are computed transactionally at match finalization; bot matches update the human's rating with a dampened weight to prevent bot farming.

### 3.6 Leaderboards

Redis ZSETs: `lb:global:{tier}` and `lb:weekly:{isoWeek}:{tier}` (weekly keys carry a TTL — resets are key expiry, not a job). `ZINCRBY` on match finalization, `ZREVRANK` for "my rank", `ZREVRANGE` for pages — all O(log n) via the underlying skip list, versus a full re-sort per query in SQL. A nightly job snapshots ZSETs to Postgres, bounding leaderboard loss on Redis failure to one day of drift while the authoritative match data remains intact.

---

## 4. Data design

### 4.1 Postgres — durable, transactional record

```sql
users            (id PK, username UNIQUE, email, auth_provider,
                  provider_subject, created_at,
                  UNIQUE (auth_provider, provider_subject))
                 -- no credentials stored; identity is delegated (§3.0)
ratings          (user_id FK, tier, rating, rd, volatility, games_played,
                  updated_at, PRIMARY KEY (user_id, tier))
matches          (id PK, tier, seed BIGINT, tier_config_version, p1 FK, p2 FK,
                  p2_is_bot BOOL, winner, p1_score, p2_score, status,
                  started_at, ended_at)
rating_history   (user_id FK, match_id FK, tier, rating_before, rating_after,
                  rd_after, created_at)
tier_configs     (tier, version, config JSONB, active BOOL, created_at)
technique_library(id PK, name, pattern_tags TEXT[], summary, worked_example)
coach_reports    (match_id FK, user_id FK, report JSONB, drill_config JSONB,
                  model_version, created_at, PRIMARY KEY (match_id, user_id))
```

Match finalization is one transaction: insert `matches`, update both `ratings`, insert two `rating_history` rows. Partial application of that set would corrupt the ladder — atomicity across related writes is precisely why this lives in a relational store. `matches` is time-partitioned monthly from day one; the honest scaling path is partitioning → read replica → (only at hundreds of millions of rows) a wide-column store keyed on (user_id, ended_at).

### 4.2 Redis — hot, ephemeral state

```
mm:queue:{tier}              ZSET   score = rating, member = userId
mm:searching:{userId}        STRING lock/window state, TTL 60s
room:{matchId}               HASH   seed, state, p1, p2, scores, qIndex,
                                    servedTs per player · TTL 10 min
match:{matchId}              PUB/SUB channel — gateway fan-out
lb:global:{tier}             ZSET   score = ladder points
lb:weekly:{isoWeek}:{tier}   ZSET   TTL = end of week + 7d
sess:{jwtId}                 STRING revocation / presence, TTL = token life
rl:{userId}:{route}          rate-limit counters, sliding window
```

Loss semantics are accepted and explicit: Redis failure drops in-flight matches (players are re-queued, no rating change) and at most one day of leaderboard drift (rebuilt from the Postgres snapshot). Nothing durable lives here.

### 4.3 Kafka — the event log

```
topic game.answers   key = matchId   (per-match ordering on one partition)
  question_served  { matchId, userId, qIndex, template, bucketTags, servedTs }
  answer_submitted { matchId, userId, qIndex, correct, value, solveMs, ts }

topic game.matches   key = matchId
  match_started    { matchId, tier, configVersion, seed, p1, p2, p2IsBot }
  match_finished   { matchId, winner, scores, durations, ratingDeltas }
```

Consumer groups: `clickhouse-ingest`, `coach-worker`, and later `anticheat-analyzer` — each independent, each replayable. Retention 30 days (long enough to replay a month of history through an improved coach). Producers in the game engine are async and fire-and-forget with a bounded in-memory buffer: a Kafka outage never blocks gameplay, it delays analytics.

### 4.4 ClickHouse — analytical store

```sql
CREATE TABLE answers (
  ts DateTime, match_id String, user_id String, tier LowCardinality(String),
  template LowCardinality(String), bucket_tags Array(String),
  correct UInt8, solve_ms UInt32, rating_at_play UInt16
) ENGINE = MergeTree ORDER BY (tier, template, ts);
```

Serves the questions no row store answers efficiently: per-bucket accuracy for tier recalibration, solve-time distributions per (template, rating band) for bot modeling, and the tier-median baselines the coach compares each player against (maintained as materialized views, refreshed continuously by ingestion).

---

## 5. AI services

### 5.1 Post-game coach

Pipeline (async consumer of `match_finished`): deterministic stats engine → LLM grounded in the technique library → report + drill config written to Postgres.

The stats engine is plain code over the match's answer events plus ClickHouse baselines. It computes per-template accuracy and solve-time percentiles versus the tier median, and detects error patterns: misses concentrated on carry/borrow buckets, answers off by exactly ±10 (place-value slips), accuracy collapse in the final third (time pressure), long-tail solve times on one template. Output is a structured profile:

```jsonc
{
  "matchId": "m_9f2c", "userId": "u_41", "tier": "intermediate",
  "accuracy": { "add_sub_carry": 0.50, "mul_2x1": 0.75, "percent": 1.0 },
  "speedPercentile": { "add_sub_carry": 18, "mul_2x1": 42, "percent": 71 },
  "patterns": ["carry_errors", "slow_final_third"],
  "notableMistakes": [ { "prompt": "47 × 6", "given": 262, "answer": 282 } ]
}
```

The LLM receives this profile plus the technique library rows whose `pattern_tags` match the detected patterns. Its contract: select at most three techniques, explain each using the player's own `notableMistakes` as worked examples, and emit a drill config over the weak buckets. It may not invent techniques, restate raw statistics, or produce advice for patterns not present in the profile — the model personalizes and teaches; it never computes and never grades. Reports are generated for ranked matches only, cached forever (a finished match is immutable), with a batched daily summary for casual play.

### 5.2 Bots

A bot with target rating R plays by sampling from empirical human behavior: per (template, bucket, rating band), fit a log-normal solve-time distribution and an error rate from ClickHouse. The bot draws a solve time and a correctness outcome per question and submits through the same WebSocket protocol as a human. Bots exist for matchmaking liquidity; bot matches are flagged (`p2_is_bot`) and apply dampened rating updates.

### 5.3 LLM-assisted question authoring

The LLM proposes new templates and parameter constraints ("two-digit multiplication where carrying is required in both partial products"); code instantiates instances and computes every answer. Generated buckets enter tiers behind the standard heuristic-then-empirical calibration path. The boundary rule is absolute: model output is never the source of truth for an answer.

---

## 6. Scalability and reliability

### 6.1 Hot-path budget (per answer)

WS receive → state check → answer re-derivation from seed → room hash update → pub/sub fan-out → Kafka async append. Every step is in-memory or O(log n) Redis; target p99 under 20 ms server-side. Postgres is structurally absent from this path.

### 6.2 Scaling each tier

Gateways scale on connection count: room state in Redis plus pub/sub fan-out means any gateway serves any player, so scaling is "add an instance behind the LB." REST API is stateless and scales on CPU. Redis scales up long before it needs Cluster at these volumes; matchmaking keys and room keys shard naturally by tier and matchId if that day comes. Kafka partitions by matchId, so consumer parallelism grows with partition count. Workers scale by consumer-group membership.

### 6.3 Failure modes

| Failure | Impact | Mitigation |
|---|---|---|
| Gateway crash | Its connections drop | Clients auto-reconnect to any gateway; room state recovered from Redis; heartbeat detects within 5 s |
| Redis outage | In-flight matches lost; matchmaking down | Accepted loss: players re-queued, no rating change; leaderboards rebuilt from nightly snapshot; AOF persistence + replica for fast recovery |
| Kafka outage | Analytics/coach delayed | Bounded producer buffer; gameplay unaffected; consumers catch up on recovery |
| Postgres outage | Ranked finalization blocked | Finalization events already durable in Kafka — replay on recovery; degrade to casual-only mode |
| LLM API outage | Coach reports delayed | Retry queue; product fully functional without reports |

### 6.4 The durability boundary, stated once

A match "happened" when its Postgres transaction commits. Everything before that is reconstructible (from the seed and the Kafka log) or acceptably losable (a live game). This single sentence resolves every "what if X dies mid-match" question consistently.

---

## 7. Security and anti-cheat

Authentication is delegated (§3.0): provider-issued OIDC tokens, verified locally against cached JWKS public keys, with a Redis ban set for platform-side enforcement. Every WS `join` re-verifies the token and re-validates the user against the room's player list. Because no credentials are stored, a full database compromise leaks no passwords. Rate limits (Redis sliding windows) cover auth, match creation, and message frequency per connection; malformed or state-invalid messages are dropped and counted, with repeated violations closing the socket.

Anti-cheat is layered. Layer one is architectural and free: answers never reach the client, and all scoring is server-side, so the classic "read the answer from the payload" and "report a fake score" attacks are impossible by construction. Layer two is online sanity checking in the game engine: solve times below a human floor (per-bucket p0.1 from ClickHouse) flag the answer, and repeated sub-human timing voids the match. Layer three is offline: an `anticheat-analyzer` Kafka consumer scores accounts on solve-time distribution shape (bots and calculator users produce unnaturally tight distributions), win-rate-versus-rating anomalies, and session velocity — demonstrating that the event log serves security as well as analytics, with zero game-engine changes.

---

## 8. Observability and testing

Metrics (Prometheus + Grafana): matchmaking wait-time histogram per tier, live room count, per-answer processing latency (p50/p99), pub/sub fan-out latency, Kafka consumer lag per group, coach report generation time and LLM cost per report. Structured logs carry matchId throughout, and any match is fully replayable from (seed, config version, event log) — the primary debugging tool for "the game did something weird" reports.

Load testing (k6): scenario A holds N concurrent duels with scripted WS clients answering at human-like intervals, measuring answer-latency p99 versus N to find the knee; scenario B floods matchmaking to validate the Lua pairing under contention (assert: zero double-matches); scenario C kills a gateway mid-run and measures reconnect-and-resume success rate. Deliberately running scenario C until recovery is boring is how the reliability story becomes demonstrable rather than claimed.

---

## 9. Build roadmap

**Phase 1 — playable core (weeks 1–3).** Modular monolith + one gateway: auth, seeded question service with the three tier configs, full duel state machine over WS, Glicko-2 finalization in Postgres, Redis leaderboard. Exit criterion: two browsers complete a fair ranked duel end to end.

**Phase 2 — systems depth (weeks 4–6).** Matchmaking with widening windows and Lua atomicity; Kafka event emission; ClickHouse ingestion with baseline materialized views; bots fitted from early gameplay data; second gateway + reconnection recovery; k6 scenarios A–C with recorded numbers.

**Phase 3 — AI layer (weeks 7–9).** Stats engine, technique library (~15 curated techniques), coach worker with the grounded-LLM contract, drill mode reusing tier machinery, anti-cheat analyzer consumer. Exit criterion: a ranked match produces a report citing the player's own mistakes and a one-tap drill that targets them.

---

## 10. Technology justification summary

| Component | Role | Why this | Rejected alternative and why |
|---|---|---|---|
| FastAPI (Python) | REST services | Team familiarity; async; fast iteration | Spring/Go — no requirement they'd serve better at this scale |
| Node.js | WS gateways | Event-loop model fits many idle sockets; backpressure control | Python WS — weaker ecosystem for this shape of load |
| Redis | Queues, rooms, pub/sub, leaderboards | In-memory latency; ZSET/Lua primitives map exactly to the problems | Postgres for queues/boards — per-query sorts and race-prone pairing |
| Postgres | Durable record | Transactions across matches/ratings; relational to its core | MongoDB — data is joins all the way down; Cassandra — see below |
| Kafka | Event log | Decoupled consumers, replay, durable ordering per match | Redis pub/sub — fire-and-forget, no history, no replay |
| ClickHouse | Analytics | Columnar aggregation over millions of events | Postgres analytics — row storage reads 100× the data per aggregate |
| Managed OIDC provider | Identity | Zero-differentiation, high-breach-risk subsystem; free social login; no credential storage | Self-built password auth — a week of work and a permanent liability |
| LLM (API) | Coach narration, template authoring | Verifiable-or-subjective outputs only | LLM as answer grader — unverifiable authority, correctness bug by design |

**On Cassandra, explicitly:** it earns its complexity at write volumes beyond a relational primary, with key-only access patterns and multi-region availability needs. None of those conditions hold here, and it surrenders the transactions §4.1 depends on. The migration trigger is named in advance: match history at hundreds of millions of rows, keyed on (user_id, ended_at) — until then, partitioned Postgres.

*The doctrine throughout: every present component has a one-sentence justification; every famous absent component has a one-sentence rejection.*
