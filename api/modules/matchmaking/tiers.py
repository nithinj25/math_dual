DEFAULT_RATING = 1500 

_THRESHOLDS = [
    (1200, "beginner"),
    (1800, "intermediate"),
]

def select_tier(rating: int) -> str:
    """Map a players rating to a difficulty tier"""
    for ceiling, tier in _THRESHOLDS:
        if rating < ceiling:
            return tier
        
    return "advanced"

