"""M9 — a consumer that does nothing but prove the pipe works.

    python consumer.py                  # resume from wherever this group left off
    python consumer.py --from-start     # replay everything ever written

Stop it, play matches, start it again: it picks up exactly where it stopped.
That bookmark is the whole point of Kafka over pub/sub.
"""
import argparse
import asyncio
import json
import os
import signal

from aiokafka import AIOKafkaConsumer
from dotenv import load_dotenv

load_dotenv()

BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "127.0.0.1:9092")
TOPICS = ("game.answers", "game.matches")
GROUP = "printer"


def render(kind: str, e: dict) -> str:
    if kind == "match_started":
        return f"match {e['matchId']} started  tier={e['tier']} seed={e['seed']}"
    if kind == "question_served":
        return (f"  served  q{e['qIndex']:<2} {e['template']:<9} "
                f"-> {e['userId'][:8]}  {','.join(e.get('bucketTags', []))}")
    if kind == "answer_submitted":
        mark = "OK " if e["correct"] else "xx "
        return (f"  answer  q{e['qIndex']:<2} {mark} value={e['value']:<7} "
                f"{e['solveMs']:>6}ms  {e['userId'][:8]}")
    if kind == "match_finished":
        winner = (e["winner"] or "draw")[:8]
        return (f"match {e['matchId']} finished  winner={winner}  "
                f"scores={list(e['scores'].values())}  "
                f"deltas={list(e['ratingDeltas'].values())}")
    return f"{kind} {e}"


async def main(from_start: bool) -> None:
    consumer = AIOKafkaConsumer(
        *TOPICS,
        bootstrap_servers=BOOTSTRAP,
        group_id=GROUP,
        # "earliest" only applies when this group has NO stored bookmark.
        # Once it has one, Kafka resumes from it regardless.
        auto_offset_reset="earliest" if from_start else "latest",
        enable_auto_commit=True,
        value_deserializer=lambda v: json.loads(v.decode()),
        key_deserializer=lambda k: k.decode() if k else None,
    )
    await consumer.start()
    print(f"consuming {TOPICS} as group '{GROUP}' from {BOOTSTRAP}")
    print("stop me with Ctrl+C, play some matches, start me again\n")

    stopping = asyncio.Event()
    try:
        loop = asyncio.get_running_loop()
        loop.add_signal_handler(signal.SIGINT, stopping.set)
    except NotImplementedError:
        pass                                  # windows: fall back to KeyboardInterrupt

    seen = 0
    try:
        async for msg in consumer:
            e = msg.value
            print(f"[{msg.topic}:{msg.partition}@{msg.offset}] "
                  f"{render(e.get('kind', '?'), e)}")
            seen += 1
            if stopping.is_set():
                break
    except KeyboardInterrupt:
        pass
    finally:
        await consumer.stop()
        print(f"\nstopped after {seen} events — bookmark saved")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-start", action="store_true",
                    help="replay from offset 0 if this group has no bookmark yet")
    args = ap.parse_args()
    try:
        asyncio.run(main(args.from_start))
    except KeyboardInterrupt:
        pass
