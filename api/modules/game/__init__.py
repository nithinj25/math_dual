# M4 — authoritative duel state machine. See DESIGN.md §3.2.
from .state import COUNTDOWN_MS, Duel, DuelStatus, IllegalActions, PlayerState
from .registry import DuelNotFound, create_duel, evict_duel, get_duel, live_count

__all__ = ["Duel", "DuelStatus", "IllegalActions", "PlayerState", "COUNTDOWN_MS",
           "create_duel", "get_duel", "evict_duel", "live_count", "DuelNotFound"]
