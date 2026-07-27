from dataclasses import dataclass
from enum import Enum

from modules.questions import Questions, generate_questions
from modules.questions.config_loader import load_tier_config

COUNTDOWN_MS = 3000


class DuelStatus(str, Enum):
    MATCHED = "matched"
    COUNTDOWN = "countdown"
    LIVE = "live"
    FINISHED = "finished"
    ABANDONED = "abandoned"
    # "rated" arrives in M5, once Glicko-2 writes land


class IllegalActions(Exception):
    """An action not permitted in the duel's current state."""


@dataclass
class PlayerState:
    player_id: str
    position: int = 0
    score: int = 0
    finished_at: float | None = None
    connected: bool = True
    rtt_ms: float = 0.0            # measured by the gateway's pings
    served_at: float | None = None  # when the current question was dispatched
    total_solve_ms: float = 0.0     # sum of estimated solve times


@dataclass
class Duel:
    match_id: str
    seed: int
    tier: str
    duration_seconds: int
    questions: list[Questions]
    players: dict[str, PlayerState]
    status: DuelStatus = DuelStatus.MATCHED
    countdown_started_at: float | None = None
    started_at: float | None = None

    @classmethod
    def create(cls, match_id: str, seed: int, tier: str,
               player_ids: list[str], duration_seconds: int = 120) -> "Duel":
        config = load_tier_config(tier)
        questions = generate_questions(seed, config)
        players = {pid: PlayerState(player_id=pid) for pid in player_ids}
        return cls(match_id, seed, tier, duration_seconds, questions, players)

    # ---- transitions ----

    def begin_countdown(self, now: float) -> None:
        if self.status is not DuelStatus.MATCHED:
            raise IllegalActions(f"cannot start countdown from {self.status.value}")
        self.status = DuelStatus.COUNTDOWN
        self.countdown_started_at = now

    def go_live(self, now: float) -> None:
        if self.status is not DuelStatus.COUNTDOWN:
            raise IllegalActions(f"cannot go live from {self.status.value}")
        self.status = DuelStatus.LIVE
        self.started_at = now

    def abandon(self, now: float) -> None:
        if self.status in (DuelStatus.FINISHED, DuelStatus.ABANDONED):
            return
        self.status = DuelStatus.ABANDONED

    # ---- gameplay ----

    def mark_served(self, player_id: str, now: float) -> None:
        """Gateway calls this the moment it dispatches a question."""
        player = self.players.get(player_id)
        if player is None:
            raise IllegalActions("not a player in this duel")
        player.served_at = now

    def submit_answer(self, player_id: str, q_index: int, answer: int, now: float) -> bool:
        if self.status is not DuelStatus.LIVE:
            raise IllegalActions(f"duel is not live (it is {self.status.value})")
        if self._expired(now):
            self._finish(now)
            raise IllegalActions("time is up")

        player = self.players.get(player_id)
        if player is None:
            raise IllegalActions("not a player in this duel")
        if player.finished_at is not None:
            raise IllegalActions("player already finished")
        if q_index != player.position:
            raise IllegalActions(f"expected question {player.position}, got {q_index}")

        # latency fairness: estimated solve time, not arrival order
        if player.served_at is not None:
            solve_ms = (now - player.served_at) * 1000.0 - (player.rtt_ms / 2.0)
            player.total_solve_ms += max(0.0, solve_ms)
        player.served_at = None

        correct = answer == self.questions[q_index].answer  # authoritative
        if correct:
            player.score += 1
        player.position += 1

        if player.position >= len(self.questions):
            player.finished_at = now
            if all(p.finished_at is not None for p in self.players.values()):
                self._finish(now)

        return correct

    def tick(self, now: float) -> None:
        if self.status is DuelStatus.COUNTDOWN and self.countdown_started_at is not None:
            if (now - self.countdown_started_at) * 1000.0 >= COUNTDOWN_MS:
                self.go_live(now)
        elif self.status is DuelStatus.LIVE and self._expired(now):
            self._finish(now)

    def result(self) -> dict:
        if self.status is not DuelStatus.FINISHED:
            raise IllegalActions("duel is not finished")

        def rank_key(p: PlayerState):
            return (-p.score, p.total_solve_ms)  # more correct, then genuinely faster

        ranked = sorted(self.players.values(), key=rank_key)
        tie = len(ranked) > 1 and rank_key(ranked[0]) == rank_key(ranked[1])
        return {
            "match_id": self.match_id,
            "winner": None if tie else ranked[0].player_id,
            "scores": {p.player_id: p.score for p in self.players.values()},
            "solve_ms": {p.player_id: round(p.total_solve_ms) for p in self.players.values()},
        }

    def _expired(self, now: float) -> bool:
        return self.started_at is not None and now - self.started_at >= self.duration_seconds

    def _finish(self, now: float) -> None:
        self.status = DuelStatus.FINISHED