import random
from .models import Questions
from .templates import GENERATORS

def generate_questions(seed: int, tier_config: dict) -> list[Questions]:
    rng = random.Random(seed)
    buckets = tier_config["buckets"]
    easy_third_end = tier_config["questionCount"] // 3 if tier_config.get("ramp") == "easyThirdFirst" else 0

    questions = []
    for i in range(tier_config["questionCount"]):
        bucket = _pick_bucket(rng, buckets, easy_phase=i < easy_third_end)
        prompt, answer, tags = GENERATORS[bucket["template"]](rng, bucket)
        questions.append(Questions(q_index=i, template=bucket["template"], prompt=prompt, answer=answer, bucket_tags=tags))
    return questions

def _pick_bucket(rng: random.Random, buckets: list[dict], easy_phase: bool) -> dict:
    if easy_phase:
        weights = [b["weight"] / b.get("difficulty", 3) for b in buckets]
    else:
        weights = [b["weight"] for b in buckets]

    return rng.choices(buckets, weights=weights, k=1)[0]
