# MathDuel — Learning Log

One entry per milestone. Keep it short — five minutes, not thirty.

Template:

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

## Phase 0 — Setup · 2026-07-23

*Note: Phase 0 was scaffolded by Claude, not built by hand, so this entry is
Claude's account rather than "in my own words." From M1 onward these entries
are the real exercise — Claude gives instructions, I write the code, I write
the entry. Full file-by-file record of Phase 0 is in `CLAUDE-SETUP-LOG.md`.*

**Built:** Repo skeleton — `docker-compose.yml` running Postgres 16 and
Redis 7 (nothing else yet, on purpose), a FastAPI project (`api/`) that
connects to both on startup, a Node+TypeScript gateway project (`gateway/`)
that connects to Redis on startup, five empty `api/modules/` packages
(`auth`, `questions`, `game`, `matchmaking`, `ratings`) each marked with the
milestone and design-doc section that will fill it in, and a dedicated git
repo initialized inside `math_dual/` (nothing committed yet).

**Concept in my own words:** The modular monolith. Everything — auth,
questions, game engine, matchmaking, ratings — runs as one FastAPI process,
but each module is only allowed to call another module through its public
functions, never by reaching into another module's database rows directly.
That self-imposed boundary is what makes pulling a module out into its own
service later (if it's ever needed) a contained job instead of a rewrite.
Two things scale independently from day one regardless: the WebSocket
gateway tier (Node, scales on connection count) and, from Phase 2 on, the
async worker tier (scales on event throughput). The rule for splitting
anything further off the monolith is "a measured reason appears" — not
"this feels more scalable."

**Decision + alternative:** Starting as a modular monolith (one deployable,
disciplined module boundaries) instead of microservices. Rejected:
splitting auth/game/matchmaking into separate services now — no team-scaling
problem exists yet to justify the operational cost. Also decided in this
phase: `docker-compose.yml` holds only Postgres + Redis (Kafka/ClickHouse are
explicitly deferred to Phase 2, M9/M10, so time isn't spent on infra that
can't be used yet); TypeScript for the gateway over plain JS; a `dev.sh`
bash script standing in for `make dev` since this machine has no `make`
binary; and the git repo scoped specifically to `math_dual/` rather than the
outer directory, because the outer directory turned out to already be an
unrelated, pre-existing git repo rooted at the home folder.

**What broke:** Nothing broke functionally. The only friction was
environmental — no `make` on this Windows machine — worked around with
`dev.sh` doing the same job (bring up infra, then run both apps, one
command).

**Numbers:** `docker compose up -d` pulled and started both containers,
reporting healthy within about a minute (mostly image pull time — postgres
image ~111 MB, redis ~4 MB). Once running, `uvicorn` logged
`connected: postgres + redis` within a couple seconds of boot; the gateway
logged `connected: redis` similarly fast on `npm run dev`.

**Still shaky on:** N/A for this entry — nothing here was hand-built yet.
Genuinely revisit this field starting at M1.

---

## M1 — Accounts and tokens · 2026-07-24

**Built:** A live Supabase project with Google as the sign-in provider.
`users` table migration (`api/migrations/001_users.sql`). Token
verification (`api/modules/auth/token.py`) — real JWKS-based verification
against Supabase's published keys, plus a `FakeAuth` path behind
`AUTH_MODE`, unused for now. `get_current_user` / `get_or_create_user`
(`api/modules/auth/dependencies.py`) and a protected `GET /me` route in
`main.py`. Confirmed end-to-end: signed in with Google, got a real
Supabase-issued access token back in the browser.

**Concept in my own words:** My app never sees my Google password because
Google authenticates me on its own domain and only ever hands my app a
short-lived authorization code — useless to anyone who intercepts it
without my client secret, which only my backend has. Supabase exchanges
that code for tokens and signs its own JWT for my app to use. Verifying
that JWT doesn't need a network call per request: Supabase publishes its
public signing keys at a JWKS endpoint, my API fetches and caches them
once, and every subsequent token gets checked locally against them —
signature, expiry, issuer, audience. The `users` table exists so my app
owns its own IDs: every other table points at `users.id`, not at
Supabase's `sub`, so if I ever add a second provider or leave Supabase
entirely, that's a one-table change instead of a schema-wide migration.

**Decision + alternative:** Used real JWKS/ES256 verification, confirmed
via `curl`'ing the JWKS endpoint directly, rather than the legacy shared
HS256 secret — this project's Supabase instance turned out to be on the
newer asymmetric-key model. `FakeAuth` was written and kept in the code
(gated behind `AUTH_MODE`) per the guide's M12 rationale, but rejected for
getting the *real* flow working now — tested directly against live
Supabase instead of taking the fake shortcut.

**What broke:**
1. Migration had a syntax error: the table was named `User` (singular),
   and `USER` is a reserved keyword in Postgres — `CREATE TABLE User (...)`
   fails outright. Renamed to `users` (plural, matches every query
   elsewhere) and fixed a `TIMESAMPTZ` typo while I was in there.
2. `pip install` landed in the wrong Python environment the first time —
   PATH resolved to a global/conda `pip` that already had `gradio`
   installed, producing dependency-conflict warnings unrelated to this
   project. Fix: always invoke `.venv/Scripts/python.exe -m pip install
   ...` directly instead of trusting whatever `pip` is on PATH.
3. Google OAuth failed with `redirect_uri_mismatch` — I'd put a local app
   URL in Google Cloud Console's Authorized Redirect URIs. Google always
   gets redirected to *Supabase's* callback URL
   (`https://<ref>.supabase.co/auth/v1/callback`), never my app's URL
   directly — that's the one that has to be registered there.
4. The test page's "Sign in" button silently did nothing on the first
   try. Root cause: I hadn't replaced the placeholder anon key, combined
   with the page using the CDN's UMD global (`window.supabase`), which
   failed before the click handler ever got attached — no visible error
   at all. Rewritten with an ES module import and on-page error text
   instead of relying on `alert()`/console output.

**Numbers:** N/A this milestone — config/wiring work, not performance work.

**Still shaky on:** Never actually finished proving the positive path —
a real token successfully hitting `/me` (200, correct user JSON) and a row
landing in `users`, plus a second login reusing that row instead of
creating a duplicate. The OAuth handshake itself is confirmed working (a
real access token was obtained), but the app-side verification of that
token was not completed before moving on. Also still owe myself the
guide's self-check questions out loud, no notes, before trusting this is
interview-ready: why the app never sees the Google password, what `users`
buys over storing the provider `sub` everywhere, what breaks if Supabase
goes down mid-tournament.
