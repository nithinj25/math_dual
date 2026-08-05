"""End-to-end smoke test for MathDuel.

Exercises every milestone built so far, against the real running stack.

    cd api
    .venv/Scripts/python.exe e2e_test.py

Requires: docker compose up -d, the API on :8000, and at least one
gateway on :8080 (a second on :8081 unlocks the cross-gateway checks).
The API must be running with AUTH_MODE=fake.
"""
import asyncio
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv                                    # noqa: E402

load_dotenv()

API = "http://127.0.0.1:8000"
GW_A, GW_B = 8080, 8081
TIER = "intermediate"

passed, failed, skipped = [], [], []


# ---------------------------------------------------------------- helpers

def check(name: str, ok: bool, detail: str = "") -> bool:
    (passed if ok else failed).append(name)
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    return ok


def skip(name: str, why: str) -> None:
    skipped.append(name)
    print(f"  SKIP  {name}   ({why})")


def call(method: str, path: str, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def solve(prompt: str) -> int:
    for pat, fn in ((r"^(\d+) × (\d+)$", lambda a, b: a * b),
                    (r"^(\d+) \+ (\d+)$", lambda a, b: a + b),
                    (r"^(\d+) - (\d+)$", lambda a, b: a - b),
                    (r"^(\d+) ÷ (\d+)$", lambda a, b: a // b),
                    (r"^(\d+)% of (\d+)$", lambda a, b: b * a // 100)):
        m = re.match(pat, prompt)
        if m:
            return fn(int(m[1]), int(m[2]))
    m = re.match(r"^(\d+)²$", prompt)
    if m:
        return int(m[1]) ** 2
    raise AssertionError(f"unparsed prompt {prompt!r}")


def section(title: str) -> None:
    print(f"\n{title}\n" + "-" * len(title))


# ---------------------------------------------------------------- 1. preflight

def preflight() -> bool:
    section("1. PREFLIGHT")
    s, r = call("GET", "/health")
    if not check("api responds on :8000", s == 200):
        return False

    from modules.auth.token import AUTH_MODE
    if not check("AUTH_MODE=fake", AUTH_MODE == "fake",
                 f"got {AUTH_MODE!r} — restart the API with AUTH_MODE=fake"):
        return False

    s, _ = call("GET", f"/internal/matchmaking/size/{TIER}")
    check("redis reachable (queue size query)", s == 200)
    return True


# ---------------------------------------------------------------- 2. auth

def auth_stage() -> tuple[str, str, str, str]:
    section("2. AUTH  (M1)")
    from modules.auth.token import make_fake_token

    suffix = uuid.uuid4().hex[:6]
    tok_a = make_fake_token(f"e2e_a_{suffix}", f"e2ea{suffix}@test.local")
    tok_b = make_fake_token(f"e2e_b_{suffix}", f"e2eb{suffix}@test.local")

    s, a = call("POST", "/internal/auth/resolve", {"token": tok_a})
    check("valid token resolves to a user", s == 200 and "user_id" in a,
          a.get("username", ""))
    s, b = call("POST", "/internal/auth/resolve", {"token": tok_b})
    check("second user resolves", s == 200 and "user_id" in b)

    s, _ = call("POST", "/internal/auth/resolve", {"token": tok_a[:-4] + "xxxx"})
    check("tampered token rejected with 401", s == 401)

    s, again = call("POST", "/internal/auth/resolve", {"token": tok_a})
    check("same token maps to the SAME user id (no duplicate row)",
          again.get("user_id") == a.get("user_id"))

    return a["user_id"], b["user_id"], tok_a, tok_b


# ---------------------------------------------------------------- 3. questions

def questions_stage() -> None:
    section("3. QUESTIONS  (M2)")
    from modules.questions import generate_questions
    from modules.questions.config_loader import load_tier_config

    for tier in ("beginner", "intermediate", "advanced"):
        cfg = load_tier_config(tier)
        qs = generate_questions(7, cfg)
        weights_ok = abs(sum(b["weight"] for b in cfg["buckets"]) - 1.0) < 1e-9
        answers_ok = all(solve(q.prompt) == q.answer for q in qs)
        check(f"{tier}: 20 questions, weights sum to 1, answers correct",
              len(qs) == cfg["questionCount"] and weights_ok and answers_ok)

    cfg = load_tier_config(TIER)
    check("same seed gives identical questions",
          generate_questions(999, cfg) == generate_questions(999, cfg))
    check("different seed gives different questions",
          generate_questions(999, cfg) != generate_questions(1000, cfg))
    check("intermediate output is frozen (old matches still replay)",
          [(q.prompt, q.answer) for q in generate_questions(12345, cfg)[:3]]
          == [("11 × 5", 55), ("8²", 64), ("81 + 90", 171)])


# ---------------------------------------------------------------- 4. anticheat

def anticheat_stage(p1: str, p2: str) -> None:
    section("4. ANTI-CHEAT  (M4)")
    from modules.questions import generate_questions
    from modules.questions.config_loader import load_tier_config

    m = f"m_e2e_{uuid.uuid4().hex[:8]}"
    s, _ = call("POST", "/internal/duels",
                {"match_id": m, "seed": 4242, "tier": TIER,
                 "player_ids": [p1, p2], "duration_seconds": 120})
    check("duel created", s == 200)

    s, r = call("POST", f"/internal/duels/{m}/answer",
                {"player_id": p1, "q_index": 0, "value": 1})
    check("answer before the match starts is rejected", s == 409,
          r.get("detail", ""))

    call("POST", f"/internal/duels/{m}/countdown")
    s, r = call("POST", f"/internal/duels/{m}/answer",
                {"player_id": p1, "q_index": 0, "value": 1})
    check("answer DURING countdown is rejected", s == 409, r.get("detail", ""))

    time.sleep(3.2)
    s, r = call("POST", f"/internal/duels/{m}/tick")
    check("countdown advances to live", r.get("status") == "live")

    s, r = call("POST", f"/internal/duels/{m}/answer",
                {"player_id": p1, "q_index": 15, "value": 0})
    check("fake qIndex (skipping ahead) is rejected", s == 409,
          r.get("detail", ""))

    call("GET", f"/internal/duels/{m}/questions/{p1}")
    s, r = call("POST", f"/internal/duels/{m}/answer",
                {"player_id": p1, "q_index": 0, "value": 0,
                 "score": 999, "correct": True})
    check("client-supplied score and correctness are ignored",
          s == 200 and r["correct"] is False and r["scores"][p1] == 0)

    s, r = call("GET", f"/internal/duels/{m}/questions/{p1}")
    check("question payload never contains the answer", "answer" not in r)

    # finish it so it does not linger
    key = generate_questions(4242, load_tier_config(TIER))
    for pid in (p1, p2):
        while True:
            s, q = call("GET", f"/internal/duels/{m}/questions/{pid}")
            if q.get("done"):
                break
            call("POST", f"/internal/duels/{m}/answer",
                 {"player_id": pid, "q_index": q["q_index"],
                  "value": key[q["q_index"]].answer})
    call("POST", f"/internal/duels/{m}/finalize")
    call("DELETE", f"/internal/duels/{m}")


# ---------------------------------------------------------------- 5. duel over ws

async def ws_player(port: int, token: str, wrong_on: set[int]) -> dict:
    import websockets
    out = {"matched": None, "opp_msgs": 0, "end": None, "answered": 0}
    async with websockets.connect(f"ws://127.0.0.1:{port}") as ws:
        await ws.send(json.dumps({"t": "join", "token": token}))
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=60)
            m = json.loads(raw)
            t = m.get("t")
            if t == "matched":
                out["matched"] = m["matchId"]
            elif t == "question":
                v = solve(m["prompt"])
                if m["qIndex"] in wrong_on:
                    v += 1
                out["answered"] += 1
                await ws.send(json.dumps({"t": "answer",
                                          "qIndex": m["qIndex"], "value": v}))
            elif t == "opp":
                out["opp_msgs"] += 1
            elif t == "end":
                out["end"] = m
                return out


async def duel_stage(tok_a: str, tok_b: str, two_gateways: bool) -> dict | None:
    section("5. LIVE DUEL OVER WEBSOCKETS  (M3, M4, M7, M8)")
    port_b = GW_B if two_gateways else GW_A
    label = f":{GW_A} and :{port_b}" if two_gateways else f"both on :{GW_A}"
    print(f"  players on {label}")
    try:
        a_task = asyncio.create_task(ws_player(GW_A, tok_a, set()))
        await asyncio.sleep(0.5)
        b_task = asyncio.create_task(ws_player(port_b, tok_b, {1, 3, 5}))
        a, b = await asyncio.wait_for(asyncio.gather(a_task, b_task), timeout=120)
    except Exception as e:                                        # noqa: BLE001
        check("duel completed over websockets", False, str(e)[:60])
        return None

    check("both players were matched", a["matched"] is not None
          and a["matched"] == b["matched"], a["matched"] or "")
    check("both answered all 20 questions",
          a["answered"] >= 20 and b["answered"] >= 20,
          f"{a['answered']} / {b['answered']}")
    check("opponent events were delivered", a["opp_msgs"] > 0 and b["opp_msgs"] > 0,
          f"{a['opp_msgs']} / {b['opp_msgs']}" +
          ("  (across processes)" if two_gateways else ""))
    check("both received an end message",
          a["end"] is not None and b["end"] is not None)
    if a["end"] and b["end"]:
        check("exactly one winner", {a["end"]["winner"], b["end"]["winner"]}
              == {"you", "them"},
              f"{a['end']['score']} vs {b['end']['score']}")
        check("rating deltas are opposite and non-zero",
              a["end"]["ratingDelta"] == -b["end"]["ratingDelta"] != 0,
              f"{a['end']['ratingDelta']:+d} / {b['end']['ratingDelta']:+d}")
    return {"a": a, "b": b}


# ---------------------------------------------------------------- 6. ratings

async def ratings_stage(p1: str, p2: str) -> None:
    section("6. RATINGS  (M5)")
    from db import connect, disconnect, pg_pool
    from modules.ratings import LOSS, WIN, Rating, update_duel

    newbie = update_duel(Rating(1500, 350), Rating(1500, 50), WIN).rating - 1500
    vet = update_duel(Rating(1500, 50), Rating(1500, 50), WIN).rating - 1500
    check("uncertain players move further than settled ones",
          newbie > vet * 2, f"+{newbie:.0f} vs +{vet:.0f}")

    a = update_duel(Rating(), Rating(), WIN).rating
    b = update_duel(Rating(), Rating(), LOSS).rating
    check("winner gains, loser loses", a > 1500 > b)

    await connect()
    try:
        pool = pg_pool()
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT rating, games_played FROM ratings WHERE user_id = ANY($1::uuid[])",
                [p1, p2])
            hist = await conn.fetchval(
                "SELECT count(*) FROM rating_history WHERE user_id = ANY($1::uuid[])",
                [p1, p2])
            matches = await conn.fetchval(
                "SELECT count(*) FROM matches WHERE p1 = $1 OR p2 = $1", p1)
        check("both players have a persisted rating row", len(rows) == 2)
        check("ratings moved off the 1500 default",
              all(abs(r["rating"] - 1500) > 0.01 for r in rows),
              " / ".join(f"{r['rating']:.1f}" for r in rows))
        check("rating_history written", hist >= 2, f"{hist} rows")
        check("match rows written", matches >= 1, f"{matches} rows")
    finally:
        await disconnect()


# ---------------------------------------------------------------- 7. leaderboard

def leaderboard_stage(p1: str) -> None:
    section("7. LEADERBOARD  (M6)")
    s, r = call("GET", f"/leaderboard/{TIER}?limit=50")
    check("board responds", s == 200)
    before = {e["user_id"]: e["points"] for e in r.get("entries", [])}
    check("our player is on the board", p1 in before,
          f"{before.get(p1, 0):.0f} pts")

    s, rk = call("GET", f"/leaderboard/{TIER}/rank/{p1}")
    check("ZREVRANK returns a rank", s == 200 and rk.get("rank", 0) >= 1,
          f"#{rk.get('rank')} of {rk.get('of')}")

    s, _ = call("POST", f"/leaderboard/{TIER}/snapshot")
    check("snapshot to postgres succeeds", s == 200)

    s, rb = call("POST", f"/leaderboard/{TIER}/rebuild")
    s2, r2 = call("GET", f"/leaderboard/{TIER}?limit=50")
    after = {e["user_id"]: e["points"] for e in r2.get("entries", [])}
    check("board rebuilds from postgres identically", before == after,
          f"{rb.get('players')} players")

    s, _ = call("GET", "/leaderboard/nonsense")
    check("unknown tier is rejected", s == 404)


# ---------------------------------------------------------------- 8. kafka

async def kafka_stage(match_id: str | None) -> None:
    section("8. EVENT LOG  (M9)")
    if match_id is None:
        skip("kafka events for the live match", "no match id from stage 5")
        return
    try:
        from aiokafka import AIOKafkaConsumer
    except ImportError:
        skip("kafka", "aiokafka not installed")
        return

    bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "127.0.0.1:9092")
    consumer = AIOKafkaConsumer(
        "game.answers", "game.matches",
        bootstrap_servers=bootstrap,
        group_id=f"e2e-{uuid.uuid4().hex[:8]}",     # fresh group: read all
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        value_deserializer=lambda v: json.loads(v.decode()),
    )
    try:
        await consumer.start()
    except Exception as e:                                        # noqa: BLE001
        skip("kafka", f"broker unreachable: {str(e)[:40]}")
        return

    # getmany honours its timeout even when nothing arrives; `async for`
    # would block forever once the topic is drained.
    kinds: dict[str, int] = {}
    sample: dict = {}
    try:
        deadline = time.time() + 25
        while time.time() < deadline:
            batches = await consumer.getmany(timeout_ms=2000)
            if not batches:
                if kinds:
                    break                      # drained, and we found our match
                continue
            for _tp, msgs in batches.items():
                for msg in msgs:
                    e = msg.value
                    if e.get("matchId") == match_id:
                        kind = e.get("kind", "?")
                        kinds[kind] = kinds.get(kind, 0) + 1
                        if kind == "answer_submitted" and not sample:
                            sample = e
            if kinds.get("match_finished"):
                break                          # seen the whole match
    except Exception:
        pass
    finally:
        await consumer.stop()

    check("match_started emitted", kinds.get("match_started", 0) == 1)
    check("question_served emitted for both players",
          kinds.get("question_served", 0) >= 40, str(kinds.get("question_served", 0)))
    check("answer_submitted emitted for every answer",
          kinds.get("answer_submitted", 0) >= 40, str(kinds.get("answer_submitted", 0)))
    check("match_finished emitted exactly once",
          kinds.get("match_finished", 0) == 1)

    # Shape, not just count. ClickHouse ingests these fields directly, so a
    # missing one would only surface as an empty analytics column later.
    need = ("tier", "template", "bucketTags", "ratingAtPlay", "solveMs", "correct")
    missing = [f for f in need if f not in sample] if sample else list(need)
    check("answer_submitted carries the fields ClickHouse needs",
          not missing, "missing: " + ", ".join(missing) if missing else
          f"{sample.get('template')} / {sample.get('bucketTags')} / "
          f"rating {sample.get('ratingAtPlay')}")


# ---------------------------------------------------------------- main

async def main() -> int:
    print("=" * 68)
    print("MathDuel end-to-end smoke test")
    print("=" * 68)

    if not preflight():
        print("\npreflight failed — fix the above and rerun")
        return 1

    p1, p2, tok_a, tok_b = auth_stage()
    questions_stage()
    anticheat_stage(p1, p2)

    import socket
    def up(port: int) -> bool:
        with socket.socket() as s:
            s.settimeout(1)
            return s.connect_ex(("127.0.0.1", port)) == 0

    if not up(GW_A):
        skip("live duel", f"no gateway on :{GW_A}")
        duel = None
    else:
        duel = await duel_stage(tok_a, tok_b, two_gateways=up(GW_B))

    await ratings_stage(p1, p2)
    leaderboard_stage(p1)
    await kafka_stage(duel["a"]["matched"] if duel else None)

    print("\n" + "=" * 68)
    print(f"  {len(passed)} passed   {len(failed)} failed   {len(skipped)} skipped")
    if failed:
        print("\n  failures:")
        for f in failed:
            print(f"    - {f}")
    print("=" * 68)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
