import json 
from functools import lru_cache
from pathlib import Path

_CONFIG_DIR = Path(__file__).parent / "tier_configs"
_VALID_TIERS = {"beginner", "intermediate", "advanced"}

@lru_cache(maxsize=None)
def load_tier_config(tier: str) -> dict:
    if tier not in _VALID_TIERS:
        raise ValueError(f"unknown tier: {tier!r}")
    return json.loads((_CONFIG_DIR / f"{tier}.json").read_text())

