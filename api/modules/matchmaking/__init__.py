# M7 — Redis ZSET queue + Lua pairing. See DESIGN.md §3.4.
from .tiers import DEFAULT_RATING, select_tier

__all__ = ["select_tier", "DEFAULT_RATING"]
