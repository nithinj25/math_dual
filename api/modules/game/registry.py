from .state import Duel, DuelStatus, IllegalActions

#match_id ->live Duel , in gateway-adjacnet process for mf
#movest to a 

_duels: dict[str, Duel] = {}

class DuelNotFound(Exception):
    """No live duel with that match_id"""
    
def create_duel(match_id: str, seed: int, tier: str,
                playre_ids: list[str], duration_seconds: int = 120) -> Duel:
    
    if match_id in _duels:
        raise IllegalActions(f"duel {match_id} already exits")
    duel = Duel.create(match_id, seed, tier, playre_ids, duration_seconds)
    _duels[match_id] = duel
    
    return duel

def get_duel(match_id: str) -> Duel:
    duel = _duels.get(match_id)
    if duel is None:
        raise DuelNotFound(match_id)
    return duel

def evict_duel(match_id: str) -> None:
    _duels.pop(match_id, None)
    
def live_count() -> int:
    return sum(1 for d in _duels.values() if d.status is DuelStatus.LIVE)


