# Claude Setup Log — Phase 0

A detailed record of everything Claude did during Phase 0 (2026-07-23), before
the collaboration mode changed to instructions-only. Kept separate from
`LEARNING-LOG.md`, which is your own record in your own words.

**Mode from this point forward:** Claude gives instructions; you run every
command and write every file. This log stops growing after Phase 0 — it's a
one-time record of the scaffold you're now building on top of.

---

## Repo / git

- `git init` was run **inside `math_dual/`**, not at the outer level. Your
  home directory (`C:\Users\Nithin J`) is itself a separate, pre-existing git
  repo (unrelated — looked accidental/for dotfile tracking). `math_dual/` now
  has its own independent nested repo, so the two never interact.
- Nothing has been committed. `git status` inside `math_dual/` will currently
  show everything as untracked/new.

## Files created

```
math_dual/
├── docker-compose.yml       Postgres 16-alpine + Redis 7-alpine, named
│                             volumes, healthchecks. Nothing else per Phase 0
│                             instructions (Kafka/ClickHouse come in Phase 2).
├── .env.example              DATABASE_URL / REDIS_URL template
├── .gitignore                .env, __pycache__, venv/.venv, node_modules,
│                             dist, *.log
├── dev.sh                    Bash script: docker compose up -d, waits for
│                             both healthchecks, then runs the api (uvicorn)
│                             and gateway (npm run dev) in parallel, killing
│                             both on Ctrl+C. Stands in for `make dev` since
│                             this machine has no `make` binary installed.
├── LEARNING-LOG.md           Seeded with the template from the build guide
│                             and a Phase 0 entry (concept/what-broke/numbers
│                             left blank — those are yours to fill in).
│
├── api/                      FastAPI project
│   ├── requirements.txt      fastapi, uvicorn[standard], asyncpg, redis,
│   │                         python-dotenv (pinned versions)
│   ├── .env                  actual local values (gitignored)
│   ├── db.py                 connect()/disconnect()/pg_pool()/redis_client()
│   │                         — creates an asyncpg pool + a redis.asyncio
│   │                         client from env vars, pings redis on connect
│   ├── main.py                FastAPI app with a lifespan hook that calls
│   │                         db.connect() on startup and logs
│   │                         "connected: postgres + redis"; a bare /health
│   │                         route
│   ├── .venv/                 Python venv (created via `python -m venv`)
│   └── modules/
│       ├── __init__.py        empty
│       ├── auth/__init__.py   comment only: "M1 — identity mapping, token
│       │                     verification. See DESIGN.md §3.0."
│       ├── questions/__init__.py   "M2 — seeded question generation..."
│       ├── game/__init__.py        "M4 — authoritative duel state machine..."
│       ├── matchmaking/__init__.py "M7 — Redis ZSET queue + Lua pairing..."
│       └── ratings/__init__.py     "M5 — Glicko-2 rating updates..."
│       (all five are placeholders only — no logic, just a pointer to which
│        milestone and design-doc section owns that folder)
│
├── gateway/                   Node + TypeScript project
│   ├── package.json           type: module; deps: ioredis, ws, dotenv;
│   │                         devDeps: typescript, tsx, @types/node,
│   │                         @types/ws; scripts: dev (tsx watch), build, start
│   ├── tsconfig.json           ES2022 / NodeNext, strict: true
│   ├── .env                    REDIS_URL (gitignored)
│   ├── node_modules/            installed via `npm install`
│   └── src/index.ts             connects to Redis via ioredis, pings it,
│                               logs "connected: redis". No WS server yet —
│                               that's M3.
│
└── loadtest/
    └── README.md               placeholder note: k6 scenarios land here in
                                Phase 2 (M12), empty until then.
```

## Commands run and their results

```
git init                                          → repo created in math_dual/
docker compose up -d                              → postgres + redis pulled,
                                                     started, both report
                                                     "healthy" in `docker compose ps`
python -m venv .venv                              → api/.venv created
.venv/Scripts/python -m pip install -r requirements.txt   → succeeded, no errors
npm install (in gateway/)                          → succeeded, no errors
uvicorn main:app --port 8000  (run ~8s, then killed)
  → log output:
    INFO:     Started server process
    INFO:     Waiting for application startup.
    INFO:mathduel.api:connected: postgres + redis
    INFO:     Application startup complete.
    INFO:     Uvicorn running on http://127.0.0.1:8000

npm run dev  (in gateway/, run ~8s, then killed)
  → log output:
    > tsx watch src/index.ts
    connected: redis
```

Both containers (`math_dual-postgres-1`, `math_dual-redis-1`) were left
running after verification.

## Decisions made and why

- **TypeScript for the gateway**, not plain JS — not mandated by the guide,
  chosen as a reasonable default for a project this deep. Easy to revisit.
- **docker-compose scoped to Postgres + Redis only** — explicit Phase 0
  instruction in the build guide; Kafka/ClickHouse arrive in Phase 2 (M9/M10)
  so as not to burn time on infra you can't use yet.
- **`dev.sh` instead of a Makefile** — this machine has no `make` on PATH.
  Functionally equivalent: one command brings up infra + both apps.
- **Auth provider already decided, not re-asked** — `DESIGN.md` (i.e.
  `mathduel-system-design.md`) §3.0 already commits to Supabase Auth + Google
  as the primary social provider. That's a standing design decision, not an
  open question for M1.
- **No `users` table / migration written yet** — that's explicitly part of
  M1's "Build" in the guide, so it was left for you rather than pre-written.

## Not done

- Nothing committed to git yet.
- `LEARNING-LOG.md` Phase 0 entry has empty Concept/What-broke/Numbers/Still-shaky
  fields — write those yourself when you're ready to close out Phase 0.
- No Supabase project created yet (external step, M1, yours to do).
- No auth/token-verification code exists yet.
