from .queue import BASE_WINDOW, MAX_WINDOW, queue_key, window_for
from .tiers import select_tier


def test_window_starts_narrow():
    assert window_for(0.0) == BASE_WINDOW


def test_window_widens_every_three_seconds():
    assert window_for(2.9) == 50      # still in the first step
    assert window_for(3.0) == 100
    assert window_for(6.0) == 150
    assert window_for(9.0) == 200


def test_window_is_capped():
    assert window_for(10_000) == MAX_WINDOW


def test_queue_key_has_no_stray_spaces():
    assert queue_key("intermediate") == "mm:queue:intermediate"


def test_tier_bands():
    assert select_tier(900) == "beginner"
    assert select_tier(1500) == "intermediate"
    assert select_tier(2100) == "advanced"
