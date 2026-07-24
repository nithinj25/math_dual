# MathDuel — Build & Learn Guide

A milestone-by-milestone path to building the project *and* actually understanding every piece of it.

---

## How to use this guide

Each milestone has the same five parts:

- **Build** — what to make. Small enough to finish in one or two sittings.
- **Concept** — the idea you need, explained plainly. Read this *while* building, not before.
- **Verify** — how you know it works. If you can't verify it, you're not done.
- **Self-check** — a question to answer out loud, in your own words, with no notes. If you can't, re-read the concept.
- **Log** — one line for your learning log.

### Four rules

**1. Build first, read second.** Don't read three articles about WebSockets before writing one. Write the broken version, hit the problem, *then* read. The reading sticks because you have a hole to put it in.

**2. Keep a learning log.** One markdown file, one entry per milestone. Template at the end. This is where your interview answers come from — six months from now you will not remember why you chose Glicko over Elo unless you wrote it down the day you decided.

**3. Explain it to nobody.** After each milestone, say the self-check answer out loud. Talking exposes fake understanding instantly — you'll hear yourself trail off. That trailing off is the signal to go back.

**4. Don't skip ahead to the interesting parts.** The AI coach is the fun bit. It's also useless without the event data that Phase 2 produces. Order matters here.

### Before you start

Create two files in your repo on day one:

- `DESIGN.md` — the system design document. Written before the code.
- `LEARNING-LOG.md` — starts empty, fills up as you go.

A repo where the design doc predates the first commit is a strong signal on its own.

---

## Phase 0 — Setup

**Build.** A `docker-compose.yml` with Postgres, Redis, and nothing else yet. A Python project (FastAPI) and a Node project (gateway) in one repo. A `make dev` that brings everything up. Add Kafka and ClickHouse in Phase 2 — not now, or you'll spend a week on infrastructure you can't use yet.

Suggested layout:

```
mathduel/
├── DESIGN.md
├── LEARNING-LOG.md
├── docker-compose.yml
├── api/                 # FastAPI — REST + game logic modules
│   ├── modules/
│   │   ├── auth/
│   │   ├── questions/   # generation + tier configs
│   │   ├── game/        # state machine, scoring
│   │   ├── matchmaking/
│   │   └── ratings/
│   └── main.py
├── gateway/             # Node — WebSocket tier
└── loadtest/            # k6 scripts (Phase 2)
```

**Concept — the modular monolith.** Those folders under `modules/` are one running program, not five services. The rule you enforce on yourself: a module may only call another module through its public interface, never by reaching into its database tables. That discipline costs nothing now and is what makes extracting the gateway later a two-day job instead of a rewrite. Microservices solve *team* scaling problems. You are one person. Start as one deployable and split when you have a measured reason.

**Verify.** `make dev` gives you a working Postgres and Redis, and both apps start and log "connected."

**Log.** *Why I'm starting as a monolith and what would make me split.*

---

## Phase 1 — A playable duel (weeks 1–3)

The goal for this whole phase: two browsers, one fair ranked match, ratings updated at the end. Nothing else.

---

### M1 — Accounts and tokens

**Build.** Outsource identity to a managed auth provider — "Sign in with Google" and email/passwordless, handled by someone else. You build only three things: the provider integration, a `users` table that maps their identity to *your* internal user ID, and token verification middleware shared by the REST API and the gateway.

You are not building: password hashing, password reset emails, email verification, session cookies, or 2FA. Every one of those is a well-known way to get breached, and none of them is what this project is demonstrating.

**Picking a provider.** Any of these have a free tier that covers a project at your scale — check current limits yourself, they change:

| Provider | Good when |
|---|---|
| **Supabase Auth** | You want Postgres + auth from one vendor; generous free tier; open source, self-hostable if you ever need to leave |
| **Clerk** | Best drop-in UI components; fastest to a working login screen |
| **Firebase Auth** | Very generous free tier; easiest Google sign-in; heavier SDK |
| **Auth0** | Most "enterprise" and best docs on the protocol itself |
| **Google OAuth direct** | No third party at all beyond Google; you handle the code exchange yourself; most educational, most fiddly |

Default recommendation: **Supabase Auth**, because you're already running Postgres, it hands you a standard JWT you can verify anywhere (which matters a lot for your gateway), and self-hosting is an escape hatch if you ever need one.

**Concept 1 — what OAuth 2.0 / OIDC actually does.** The point is that your app never sees the user's Google password. The flow:

1. Your app redirects the user to Google with "I'm app X, I want to know who this is."
2. The user logs in *on Google's domain* and approves.
3. Google redirects back to your app with a short-lived **authorization code**.
4. Your backend exchanges that code (plus a client secret) for tokens.

Two tokens come back and people constantly confuse them. The **access token** is for *calling APIs on the user's behalf* — "let me read their calendar." The **ID token** is for *knowing who they are* — a JWT containing a `sub` (their permanent unique ID), email, and name. You want the ID token. OIDC is just the thin identity layer bolted onto OAuth 2.0 to standardize that ID token, because OAuth alone was designed for permissions, not login.

Why the code step exists at all, rather than handing tokens straight to the browser: the code is useless without your client secret, so intercepting the redirect URL gains an attacker nothing.

**Concept 2 — verifying someone else's JWT.** This is the piece that keeps your architecture intact. Your provider signs tokens with a private key and publishes the matching **public** key at a JWKS endpoint. Your API and your gateway fetch that key once, cache it, and can then verify any token locally — signature valid, not expired, issuer and audience match. No network call to the provider per request.

That's the same stateless-verification property you'd have had with self-issued JWTs, which means M3's gateway design doesn't change at all. You still can't un-issue a token, so you still keep a Redis set of banned user IDs that the gateway checks on connect — that's *your* ban logic, separate from the provider's session logic, and you want it to be yours.

**Concept 3 — own your user IDs.** Never scatter the provider's ID through your schema. One table owns the mapping:

```sql
users (
  id UUID PRIMARY KEY,              -- yours, used everywhere else
  auth_provider TEXT,               -- 'google' | 'supabase' | ...
  provider_subject TEXT,            -- the 'sub' claim from the token
  username TEXT UNIQUE,             -- yours; the provider doesn't own display names
  email TEXT,
  created_at TIMESTAMPTZ,
  UNIQUE (auth_provider, provider_subject)
)
```

Every foreign key elsewhere — `ratings.user_id`, `matches.p1` — points at `users.id`. Switching providers, or adding a second one later, then costs you one table instead of a migration across your whole schema. This is the boundary that makes outsourcing safe rather than lock-in.

**Concept 4 — the tradeoff, stated honestly.** You gain: no credential storage (so a breach of your DB leaks no passwords), free Google/Apple sign-in, password reset and email verification handled, and roughly a week of your time back. You give up: a hard dependency on someone else's uptime for *login* (existing sessions keep working, so a provider outage degrades rather than kills you), free-tier limits you could theoretically outgrow, and slightly awkward local development. For that last one, put verification behind an interface with a `FakeAuth` implementation that mints test tokens, so your k6 scripts in M12 and your integration tests never touch the real provider.

**Verify.** Sign in with Google end to end. Confirm a row appears in `users` with your internal UUID. Confirm `GET /me` accepts a real token, and rejects one with a tampered payload, an expired one, and one signed by the wrong key. Confirm your `FakeAuth` path works with the provider fully disabled.

**Self-check.** Explain why your app never sees the Google password, and what the authorization code is for. Then: what does your `users` table buy you that storing the Google `sub` directly on every table wouldn't? And what specifically breaks if your auth provider goes down mid-tournament?

**Log.** *Why I outsourced auth, which provider and why, the ID-token-vs-access-token distinction, and the boundary I kept (my own user IDs + my own ban list).*

---

### M2 — Questions from a seed

**Build.** A question generator that takes `(seed, tier_config)` and produces a list of 20 questions, each with a prompt and an answer. Same inputs must give byte-identical output every single time. Write the three tier configs (beginner / intermediate / advanced) as JSON, exactly as specified in the design doc.

**Concept — deterministic generation.** A pseudorandom number generator is not random. It's a function: give it the same seed, it emits the same sequence forever. So instead of storing a bank of questions and copying them into each match, you write generators that pull numbers off the RNG stream and build questions from them.

Three things fall out of this, and all three matter:

- Both players get identical questions with zero coordination — you send them the same seed, or the server derives for both.
- The entire match is reproducible from one 64-bit integer. Debugging a "the game glitched" report means replaying the seed. You store the seed, not the questions.
- The client can receive prompts with no answers attached, and the server re-derives answers on demand. There's nothing in the payload to cheat with.

The catch: your generator's output must never change, or old seeds replay differently. That's why every match row stores `tier_config_version` alongside the seed. Change a config, bump the version, old matches still replay correctly.

**Verify.** A test that generates from seed `12345` twice and asserts the two lists are identical. Then a test asserting seed `12345` and seed `12346` differ.

**Self-check.** A player claims the game marked a correct answer wrong. You have their match ID. Walk through exactly how you investigate.

**Log.** *Seeded generation — what it buys me (fairness, replay, anti-cheat) and the versioning trap.*

---

### M3 — Your first WebSocket

**Build.** A Node gateway that accepts a WS connection, validates the JWT on connect, echoes messages back, and handles disconnects without crashing. No game logic yet.

**Concept — why WebSockets and not HTTP.** HTTP is one request, one response, connection closed. To show a live opponent score you'd have to poll — "any updates? any updates?" — which is wasteful and always a poll-interval behind. A WebSocket is one connection held open, and either side can send at any time. That's what makes real-time feel real-time.

The price: connections are *stateful*. An HTTP server can be killed and restarted and nobody notices. Kill a WS server and every connected player drops. That single fact drives a big architectural decision in M8, so notice the discomfort now.

You're using Node here specifically because its event loop handles thousands of mostly-idle connections cheaply — this is exactly the workload it's built for, and you already know why from your Node internals work.

**Verify.** Connect from a browser console, send a message, get it back. Kill the server; watch the client detect the drop.

**Self-check.** Why can't you just use HTTP polling? Give a concrete number for what it costs.

**Log.** *WS vs HTTP, and the statefulness problem I've just created for myself.*

---

### M4 — The duel state machine

**Build.** The core loop. Two connected players, a match that moves `matched → countdown → live → finished`, questions pushed one at a time, answers validated server-side, scores updated, an end message. Use the exact message schema from `DESIGN.md` §3.2.

**Concept 1 — the authoritative server.** The client is an untrusted input device. It sends "player pressed 42 at time T" and *nothing else*. It never sends "I got it right" or "my score is 8," because anyone with devtools open can send whatever they like. The server decides correctness, timing, and score. This isn't paranoia — it's also the only way two players can agree on one reality, since there must be exactly one ordering of events and only a central arbiter can produce it.

**Concept 2 — state machines.** Model the match as explicit states with explicit legal transitions, not a pile of boolean flags. Every incoming message gets checked against the current state: an answer during `countdown` is rejected, a rematch request during `live` is ignored. The reason to be strict about this now is that features pile up later — reconnection, forfeits, rematches — and a flags-based version becomes unfixable around feature four. You've already built this discipline in your order matching engine; it's the same shape.

**Concept 3 — latency fairness.** Player A on fibre and player B on 4G don't have equal round trips, so "first answer to arrive wins" quietly favours A. The fix: record when the question was *dispatched* to each connection, measure each player's RTT with periodic pings, and score on estimated solve time (`arrival − dispatch`, optionally minus half the RTT) rather than arrival order. You can't make this perfect. You make it good enough that 40 ms of network doesn't decide matches, and you can explain the tradeoff.

**Verify.** Two browser tabs play a full match. Then cheat: send an answer with a fake `qIndex`, send an answer during countdown, send a score. All three rejected.

**Self-check.** Explain, without saying "security," why the server must own scoring. Then explain why arrival order isn't the same thing as who answered faster.

**Log.** *Authoritative server, the state machine, and how I handle latency fairness.*

---

### M5 — Ratings and the one transaction that matters

**Build.** Glicko-2 rating updates at match end. Write `matches`, both `ratings` rows, and both `rating_history` rows — in a single database transaction.

**Concept 1 — why Glicko-2 over Elo.** Elo moves your rating by `K × (actual − expected)`, where expected comes from a curve on the rating gap. Its flaw is one fixed K: a brand-new player and a 2,000-game veteran move at the same speed. So new players grind for dozens of games to reach their true level, and veterans get shoved around by noise.

Glicko-2 tracks *uncertainty* alongside rating. Each player has a rating deviation (RD) — high when new or long inactive, shrinking as they play — and updates scale by it. High-RD players move fast, because the system is openly admitting it doesn't know them yet. Low-RD players move slowly. The one-line version: **Elo is a point estimate; Glicko is a point estimate plus a confidence interval, and the confidence interval is what makes onboarding not miserable.**

**Concept 2 — why this is a transaction.** If the process dies after inserting the match but before updating ratings, your ladder is now permanently wrong, and no retry can detect it. A transaction makes all four writes land or none of them. This is the *entire* reason a relational database is in your stack — not because it stores rows, but because it can make several related writes atomic. Bank it as your answer to "why Postgres and not Mongo."

**Verify.** Play a match, check both players' ratings moved in opposite directions. Then force a crash mid-transaction (raise an exception after the match insert) and confirm the database has neither the match nor the rating change.

**Self-check.** What exactly breaks if a new player and a veteran both use K=32? And what does RD have to do with fixing it?

**Log.** *Glicko vs Elo in one sentence. Plus: the transaction is why Postgres is here.*

---

### M6 — Leaderboards

**Build.** A Redis ZSET per tier. `ZINCRBY` on match end, `ZREVRANGE` for the top 50, `ZREVRANK` for "my rank." A nightly job that snapshots the ZSET into Postgres.

**Concept — why a ZSET beats SQL here.** A Redis sorted set is a hash map plus a skip list over the same members. The hash gives you O(1) "what's this player's score." The skip list keeps members ordered by score, so rank lookups, top-N pages, and score updates are all O(log n).

Now the SQL version: `SELECT ..., rank() OVER (ORDER BY score DESC)` re-sorts your whole table on every request, and "what's *my* rank" is a full scan away. At a thousand rows nobody notices. At a million it's your slowest endpoint.

The pattern to internalize: **Redis is the hot live view, Postgres is the durable record.** A Redis crash costs you at most a day of leaderboard drift — the matches themselves are already safe in Postgres and the board can be rebuilt. Weekly boards are just separate keys (`lb:weekly:2026-W30`) with a TTL, which means "resetting the weekly leaderboard" isn't a job you write. It's a key expiring.

**Verify.** Play matches; the board reorders correctly. Flush Redis; confirm you can rebuild the board from Postgres.

**Self-check.** Why is O(log n) per update better than "just add an index on the score column"?

**Log.** *ZSET internals, and the hot-view / durable-record split.*

---

### End of Phase 1

You have a real game. Before moving on, write a Phase 1 retro in your log: what took longest, what you'd design differently, and which concept you'd struggle to explain under pressure. Go fix that last one.

---

## Phase 2 — Systems depth (weeks 4–6)

This is the phase that makes the project interview-worthy. Phase 1 proves you can build. Phase 2 proves you can reason about scale and failure.

---

### M7 — Matchmaking without race conditions

**Build.** A Redis ZSET queue per tier, scored by rating. Search window starts at ±50 and widens by 50 every 3 seconds of waiting. Pairing runs as a Lua script.

**Concept 1 — the race condition you're avoiding.** Naive version: matchmaker instance A reads the queue, finds Nithin and Arjun, pairs them. At the same moment instance B reads the same queue, sees the same two players (A hasn't removed them yet), and pairs them too. Now two matches exist with the same players. This isn't a rare edge case; it's what *always* happens under load.

**Concept 2 — atomicity via Lua.** Redis runs a Lua script as one indivisible operation — no other command interleaves. So you write "find a candidate in my window, remove both, return the pair" as one script, and the race is gone by construction. Notice this is the same idea as M5's transaction, in a different system. **Atomicity is one concept; every datastore has its own name for it.**

**Concept 3 — the widening window is a product decision.** A narrow window means well-matched opponents and long waits. A wide window means instant matches against mismatched players. There's no correct answer — there's a choice, and yours is "favour speed while the player base is small, because an app that feels empty dies." Being able to say *that* sentence is the point.

**Verify.** Write a script that fires 200 simultaneous queue joins. Assert zero players end up in two matches.

**Self-check.** Describe the double-match bug and why Lua fixes it. Then: what's the cost of a wider window, in one sentence?

**Log.** *Race conditions in matchmaking, Redis atomicity, and the quality/speed tradeoff.*

---

### M8 — Making gateways stateless

**Build.** Move all room state out of gateway memory into a Redis hash (`room:{matchId}`). Use Redis pub/sub to pass messages between gateways. Then run *two* gateway instances behind a load balancer and confirm a match works when the two players land on different ones. Add reconnection: a dropped client rejoins any gateway and resumes mid-match.

**Concept — state in the process is the enemy.** A WebSocket connection is pinned to one server; that's unavoidable. The question is whether the *game state* is pinned too. If room state lives in gateway memory, three bad things follow: both players must be routed to the same box, that box crashing destroys the match, and scaling means clever routing.

Move the state to Redis and all three vanish. When player A's gateway receives an answer, it publishes to channel `match:{id}`; whichever gateway holds player B is subscribed and forwards it down. Now any gateway serves any player, scaling is "add a box," and reconnection just reads the room hash.

The cost, which you must be able to name: one extra Redis hop of latency per message, and Redis pub/sub is fire-and-forget — a message sent during a subscriber's blip is simply gone. That's fine for game ticks. It's exactly why durable facts go somewhere else in M9.

**Verify.** Two players on two different gateways complete a match. Then `docker kill` one gateway mid-match and watch that player reconnect and resume.

**Self-check.** Why can't gateways just keep rooms in memory? Give the three consequences. And why is pub/sub acceptable here but not for match results?

**Log.** *Externalizing state, pub/sub fan-out, and what pub/sub can't do.*

---

### M9 — The event log

**Build.** Add Kafka to docker-compose. The game engine appends an event for every question served, every answer, and every match finished — asynchronously, keyed by `matchId`. Then write one trivial consumer that just prints events, to prove the pipe works.

**Concept — the notebook.** Kafka is an append-only notebook. Programs write lines at the bottom; other programs read lines and keep their own bookmark. Reading does **not** erase — that's the whole difference from a normal queue.

The four words:

| Word | Plain meaning |
|---|---|
| **Topic** | Which notebook. One for answers, one for match lifecycle. |
| **Partition** | A notebook split into several written side by side, so writes go faster. Order is guaranteed *inside* one, never *across* them. |
| **Offset** | The line number. Never changes, never reused. A bookmark is just an offset. |
| **Consumer group** | A team of readers sharing one set of bookmarks. Different teams read the same lines independently and can't see each other. |

Why key by `matchId`: Kafka sends the same key to the same partition every time, so all of one match's events land in one notebook and stay in order. Different matches may interleave, and no consumer ever cares.

What this buys you, concretely:

- **The game writes and walks away.** One async append, microseconds, no waiting on anyone. Compare calling the analytics and coach services directly: their latency becomes your player's latency, their outage becomes your outage.
- **New readers cost zero game code.** The anti-cheat consumer in M16 is a new team with new bookmarks reading lines that were already being written. You never open the game engine again.
- **Replay.** Bookmarks move backwards. Improve the coach in Phase 3 and you rewind to the start of the month and regenerate every report.
- **Slowness becomes a metric, not an outage.** A backed-up consumer is "lag: 4 minutes, draining" on a dashboard.

**Verify.** Play a match; watch events appear in order in your printing consumer. Then stop the consumer, play three more matches, restart it — confirm it catches up from where it stopped and misses nothing.

**Self-check.** Your coach worker crashes Friday night, unnoticed until Monday. Forty hours of matches happened. What state did it need saved, where does it resume, what happens to those reports, and did the game or the other consumer notice anything?

**Log.** *Kafka in my own words. Log vs queue. Why pub/sub couldn't do this.*

---

### M10 — Analytics that don't touch the game

**Build.** ClickHouse in docker-compose, a consumer group that ingests answer events into it, and three queries: accuracy per question bucket, solve-time distribution per (bucket, rating band), and tier-median solve times.

**Concept — row storage vs column storage.** Postgres stores a whole row together on disk. To average solve times over 10 million answers, it reads all 10 million *complete* rows — every column, including ones you didn't ask for.

ClickHouse stores each column separately. That same query reads two columns and skips everything else. And because a column holds one type of similar values, it compresses 10–20×, so you're reading a fraction of a fraction. That's the 100× difference, and it's why the split is: **Postgres answers "fetch this match," ClickHouse answers "aggregate all matches."**

The other half of the point: these queries run against a *copy* of the data, fed by the event log. No analytics query can ever slow down a live game, because analytics and gameplay don't share a database at all.

**Verify.** Load a few hundred thousand synthetic events. Run the same aggregate in Postgres and ClickHouse; record both timings in your log. Actual numbers beat "it's faster."

**Self-check.** Why is columnar faster for aggregates and *worse* for "give me match m_9f2c"?

**Log.** *Columnar vs row storage, with my measured numbers.*

---

### M11 — Bots that feel human

**Build.** Fit a log-normal solve-time distribution and an error rate per (bucket, rating band) from your ClickHouse data. A bot with target rating R samples from the matching distribution and plays through the same WebSocket protocol as a human. Matchmaking injects one after 10 seconds of no human match.

**Concept — this is a systems fix, not an AI feature.** The problem is liquidity: an empty queue means nobody can play, which means the queue stays empty. Bots break the loop. It's structurally identical to market makers providing liquidity in an order book — a comparison worth making explicitly, given your quant background.

Why sampling from real distributions rather than "wait N seconds then answer": human solve times aren't uniform, they're right-skewed — usually quick, occasionally a long pause. Log-normal captures that. A bot drawn from real human data feels human because it *is* human data.

Flag bot matches (`p2_is_bot`) and dampen the rating change, or farming bots becomes the optimal strategy.

**Verify.** Play a bot. If it feels robotic, your distribution is wrong — check whether you're sampling per bucket or globally.

**Self-check.** Why not just use a fixed delay? And why must bot matches affect rating differently?

**Log.** *Bots as a liquidity solution; distribution fitting.*

---

### M12 — Load testing and failure drills

**Build.** Three k6 scenarios: (A) N concurrent duels with scripted clients answering at human-like intervals, measuring answer latency as N climbs; (B) a flood of simultaneous matchmaking joins, asserting zero double-matches; (C) killing a gateway mid-run and measuring reconnect success rate.

**Concept 1 — percentiles, not averages.** An average hides your worst experiences. If 99 requests take 5 ms and one takes 2 seconds, the average is a comfortable 25 ms while one player in a hundred had their match ruined. Report p50, p95, p99. **p99 is the number that describes how your product actually feels**, because at scale every player hits p99 sometimes.

**Concept 2 — find the knee.** Ramp load until latency stops being flat and starts curving upward. That inflection point is your real capacity, and the interesting work is diagnosing *what* saturated — CPU, Redis round trips, connection limits. "It handles 5,000 concurrent duels at p99 = 45 ms, and the bottleneck at that point was X" is a sentence very few candidates can say about their own project.

**Concept 3 — practise failure deliberately.** Scenario C exists so that gateway crashes become boring. Rehearsed recovery is the difference between a reliability *claim* and a reliability *story*.

**Verify.** A chart of p99 versus concurrent matches, with the knee marked and the bottleneck named.

**Self-check.** Why report p99 instead of the mean? What does the knee tell you?

**Log.** *My numbers, my knee, my bottleneck. Plus what broke first and why.*

---

## Phase 3 — The AI layer (weeks 7–9)

Now the data exists, so the AI can be real instead of decorative.

---

### M13 — The stats engine (no AI yet)

**Build.** Plain code that turns one match's events plus ClickHouse baselines into a structured profile: accuracy per bucket, solve-time percentile versus tier median, and detected error patterns — misses concentrated on carry questions, answers off by exactly ±10 (place-value slips), accuracy collapsing in the final third (time pressure). Output the JSON from `DESIGN.md` §5.1.

**Concept — do the deterministic part deterministically.** Every fact here is computable with aggregation. Code that computes them is never wrong, costs nothing, and needs no prompt engineering. The temptation is to hand raw events to an LLM and ask "what's wrong with this player?" — which produces vaguer answers, costs money per call, and occasionally invents things.

This is the boundary rule of the whole AI layer: **code computes facts, the model narrates them.** Get the facts perfect before the model ever sees them.

**Verify.** Hand-play a match deliberately failing every carry question. Confirm `carry_errors` appears in the profile.

**Self-check.** Which parts of the profile *could* an LLM produce, and why is it still wrong to let it?

**Log.** *The code/model boundary, and why I drew it here.*

---

### M14 — The grounded coach

**Build.** A `technique_library` table with ~15 mental-math techniques (left-to-right addition, the distributive split `47×6 = 40×6 + 7×6`, complement subtraction `83−48 = 83−50+2`, difference of squares, digit-sum checking), each tagged with the weakness pattern it fixes and a worked example. Then a worker consuming `match_finished` that sends the model the profile plus *only* the library rows matching detected patterns, and writes the report to Postgres.

**Concept — grounding.** An ungrounded model asked "how do I get better at multiplication?" produces generic advice you could have written yourself. A grounded model receives specific facts (your accuracy, your actual wrong answers) and a curated menu it must choose from, and produces: *"On 47×6 you answered 262. Try splitting it: 40×6 = 240, then 7×6 = 42, total 282."*

The model's job is **selection and personalization**, not invention. It may not make up techniques, restate raw statistics, or give advice for patterns not in the profile. Every technique it can recommend was vetted by you, which is exactly why the advice stays correct.

Operationally: this runs as a consumer, never in the request path. Reports are cached forever, since a finished match never changes. Ranked matches only, or your LLM bill scales with casual play.

**Verify.** Two matches with different weaknesses produce genuinely different reports that cite the player's own mistakes.

**Self-check.** What stops the coach from giving confidently wrong advice? Name two mechanisms.

**Log.** *Grounding, the library, and the constraints in my prompt.*

---

### M15 — Drills that reuse everything

**Build.** The coach emits a drill config — the same shape as a tier config, weighted toward this player's weak buckets. A "practice this" button generates a session from it.

**Concept — good factoring shows up here.** You're not building a practice mode. You're generating a config and handing it to the question service you wrote in M2. If this milestone takes more than an afternoon, your tier config abstraction was wrong, and that's genuinely useful to discover.

**Verify.** A coach report's drill button produces a session visibly concentrated on the weak buckets.

**Log.** *Where good abstractions paid off.*

---

### M16 — Anti-cheat, for free

**Build.** A new consumer group scoring accounts on solve-time distribution shape (bots and calculator users produce unnaturally *tight* distributions — humans are noisy), win-rate anomalies versus rating, and session velocity. Plus an inline check in the game engine: solve times below a human floor get flagged.

**Concept — the payoff for M9.** You're adding a security subsystem by writing one new consumer. Zero changes to the game engine. That's the decoupling argument made concrete, and it's the strongest possible answer to "why Kafka?" — because you can point at a feature you added months later without touching the code it depends on.

Note the layering: architecture prevented the obvious cheats for free back in M2 and M4 (answers never reach the client, scoring is server-side). This layer catches what's left.

**Self-check.** List your three anti-cheat layers and what each one catches.

**Log.** *Layered defence, and how M9 made this cheap.*

---

## Learning log template

Copy this per milestone. Keep it short — five minutes, not thirty.

```markdown
## M__ — [name] · [date]

**Built:** one or two sentences.

**Concept in my own words:** no jargon, no copying. If this is hard to
write, you didn't understand it yet.

**Decision + alternative:** what I chose, what I rejected, why.

**What broke:** the bug that cost the most time, and the actual cause.

**Numbers:** any measurement (latency, throughput, timings).

**Still shaky on:** be honest. Revisit these before interviews.
```

---

## Interview question bank

If you can answer these cold, the project is doing its job. Attempt them at the end of each phase — the gaps tell you what to re-read.

**Architecture**
1. Walk me through what happens from "player taps play" to "rating updated."
2. Why a monolith? What would make you split it?
3. Why is Postgres not in the per-answer path?

**Real-time**
4. Why WebSockets over polling — with numbers?
5. How does a match survive a gateway crash?
6. Two players, different network speeds. How is it fair?

**Data**
7. Why Redis ZSETs for leaderboards instead of SQL?
8. Why Kafka and not Redis pub/sub? Give a capability pub/sub lacks.
9. Why ClickHouse and not just Postgres for analytics?
10. Why *isn't* Cassandra in this design? What would change your mind?

**Correctness**
11. How do you guarantee both players get identical questions?
12. What stops a player from faking their score?
13. Where are your race conditions, and how are they prevented?

**Identity**
13a. Why didn't you build your own login? What would change your mind?
13b. Walk me through the OAuth flow. Why does the authorization code step exist?
13c. How does your WebSocket gateway verify a token it didn't issue?

**Scale**
14. What breaks first at 100× traffic?
15. What's your p99 and what's the bottleneck at the knee?
16. Postgres goes down mid-match. What happens?

**AI**
17. Where does AI genuinely earn its place, and where did you refuse it?
18. How do you stop the coach giving wrong advice?
19. Why not have the LLM generate and grade questions?

---

## Reading list

Read these *when the milestone needs them*, not upfront.

| When | Read |
|---|---|
| M1 | Your chosen provider's quickstart; then "OAuth 2.0 Simplified" (Aaron Parecki) for the flow, and the JWT / JWKS verification docs for your language |
| M3–M4 | MDN WebSockets API; the `ws` library docs |
| M5 | Glickman's original Glicko-2 paper (short, readable, has worked examples) |
| M6–M7 | Redis docs on sorted sets and Lua scripting |
| M8 | Redis pub/sub docs; anything on horizontal scaling of stateful connections |
| M9 | Kafka's own "Introduction" and "Design" pages — skip the rest |
| M10 | ClickHouse "Why is ClickHouse fast?" |
| M12 | k6 docs on thresholds and scenarios |
| M13–M14 | Anthropic's prompt engineering guide, especially grounding and structured output |

---

## One last thing

At the end, write a `README.md` that opens with the architecture diagram and one paragraph per major decision — each stating what you chose, what you rejected, and why. That README, plus your learning log, *is* your interview preparation. The code is almost the least important artifact you'll produce here.
