import json
import re
from pathlib import Path

import pytest

from .config_loader import load_tier_config
from .generator import generate_questions

CONFIG = json.loads((Path(__file__).parent / "tier_configs" / "intermediate.json").read_text())
TIERS = ("beginner", "intermediate", "advanced")


def test_same_seed_is_identical():
    a = generate_questions(12345, CONFIG)
    b = generate_questions(12345, CONFIG)
    assert a == b


def test_different_seed_differs():
    a = generate_questions(12345, CONFIG)
    b = generate_questions(123456, CONFIG)
    assert a != b


def test_intermediate_output_is_frozen():
    """A seed must mean the same thing forever, or old matches stop
    replaying. If this fails, you changed generation — bump a config
    version rather than editing in place."""
    qs = generate_questions(12345, CONFIG)
    assert [(q.prompt, q.answer) for q in qs[:3]] == [
        ("11 × 5", 55), ("8²", 64), ("81 + 90", 171),
    ]


@pytest.mark.parametrize("tier", TIERS)
def test_tier_config_loads_and_generates(tier):
    cfg = load_tier_config(tier)
    qs = generate_questions(1, cfg)
    assert len(qs) == cfg["questionCount"]


@pytest.mark.parametrize("tier", TIERS)
def test_weights_sum_to_one(tier):
    total = sum(b["weight"] for b in load_tier_config(tier)["buckets"])
    assert abs(total - 1.0) < 1e-9


def _truth(prompt: str) -> int:
    """Solve the prompt independently of the generator."""
    for pattern, fn in (
        (r"^(\d+) × (\d+)$", lambda a, b: a * b),
        (r"^(\d+) \+ (\d+)$", lambda a, b: a + b),
        (r"^(\d+) - (\d+)$", lambda a, b: a - b),
        (r"^(\d+) ÷ (\d+)$", lambda a, b: a // b),
        (r"^(\d+)% of (\d+)$", lambda a, b: b * a // 100),
    ):
        m = re.match(pattern, prompt)
        if m:
            return fn(int(m[1]), int(m[2]))
    m = re.match(r"^(\d+)²$", prompt)
    if m:
        return int(m[1]) ** 2
    raise AssertionError(f"unparsed prompt: {prompt!r}")


@pytest.mark.parametrize("tier", TIERS)
def test_every_answer_is_actually_correct(tier):
    """Also catches non-exact division and fractional percents, which
    would produce a question with no integer answer."""
    cfg = load_tier_config(tier)
    for seed in range(50):
        for q in generate_questions(seed, cfg):
            if "÷" in q.prompt:
                a, b = (int(x) for x in re.findall(r"\d+", q.prompt))
                assert a % b == 0, f"{tier}: non-exact division {q.prompt}"
            if "%" in q.prompt:
                pct, base = (int(x) for x in re.findall(r"\d+", q.prompt))
                assert (base * pct) % 100 == 0, f"{tier}: fractional {q.prompt}"
            assert _truth(q.prompt) == q.answer, f"{tier}: {q.prompt} != {q.answer}"
