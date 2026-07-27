import pytest

from .state import Duel, DuelStatus, IllegalActions


def make_duel() -> Duel:
    return Duel.create("m1", seed=12345, tier="intermediate",
                       player_ids=["alice", "bob"], duration_seconds=120)


def live_duel() -> Duel:
    """A duel that has finished its countdown and is accepting answers."""
    duel = make_duel()
    duel.begin_countdown(now=0.0)
    duel.go_live(now=3.0)
    return duel


def test_starts_in_matched():
    assert make_duel().status is DuelStatus.MATCHED


def test_cannot_submit_before_countdown():
    duel = make_duel()
    with pytest.raises(IllegalActions):
        duel.submit_answer("alice", 0, 0, now=0.0)


def test_cannot_submit_during_countdown():
    """Cheat test 2 from the guide: an answer during countdown is rejected."""
    duel = make_duel()
    duel.begin_countdown(now=0.0)
    with pytest.raises(IllegalActions):
        duel.submit_answer("alice", 0, duel.questions[0].answer, now=1.0)


def test_countdown_advances_to_live_on_tick():
    duel = make_duel()
    duel.begin_countdown(now=0.0)
    duel.tick(now=1.0)                    # still counting down
    assert duel.status is DuelStatus.COUNTDOWN
    duel.tick(now=3.5)                    # past COUNTDOWN_MS
    assert duel.status is DuelStatus.LIVE


def test_authoritative_scoring():
    duel = live_duel()
    correct = duel.questions[0].answer
    assert duel.submit_answer("alice", 0, correct, now=4.0) is True
    assert duel.submit_answer("bob", 0, correct + 1, now=4.0) is False
    assert duel.players["alice"].score == 1
    assert duel.players["bob"].score == 0


def test_must_answer_in_order():
    """Cheat test 1 from the guide: a fake qIndex is rejected."""
    duel = live_duel()
    with pytest.raises(IllegalActions):
        duel.submit_answer("alice", 5, 0, now=4.0)


def test_time_expiry_finishes_duel():
    duel = live_duel()
    duel.tick(now=200.0)
    assert duel.status is DuelStatus.FINISHED


def test_rtt_is_discounted_from_solve_time():
    """Concept 3: a slower network must not read as a slower player."""
    duel = live_duel()
    duel.players["alice"].rtt_ms = 20.0     # fibre
    duel.players["bob"].rtt_ms = 200.0      # 4G
    duel.mark_served("alice", now=10.0)
    duel.mark_served("bob", now=10.0)
    answer = duel.questions[0].answer
    duel.submit_answer("alice", 0, answer, now=12.0)   # identical wall-clock
    duel.submit_answer("bob", 0, answer, now=12.0)     # identical wall-clock
    assert duel.players["bob"].total_solve_ms < duel.players["alice"].total_solve_ms
