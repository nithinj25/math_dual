from .glicko2 import DRAW, LOSS, WIN, Rating, update, update_duel


def test_matches_glickman_paper():
    """The worked example from Glickman's Glicko-2 paper."""
    result = update(Rating(1500, 200, 0.06), [
        (Rating(1400, 30), WIN),
        (Rating(1550, 100), LOSS),
        (Rating(1700, 300), LOSS),
    ])
    assert abs(result.rating - 1464.06) < 0.02
    assert abs(result.rd - 151.52) < 0.02
    assert abs(result.volatility - 0.059996) < 1e-5


def test_winner_gains_loser_loses():
    a, b = Rating(), Rating()
    a2 = update_duel(a, b, WIN)
    b2 = update_duel(b, a, LOSS)
    assert a2.rating > a.rating
    assert b2.rating < b.rating


def test_uncertainty_shrinks_when_you_play():
    before = Rating()                       # rd 350, brand new
    after = update_duel(before, Rating(), WIN)
    assert after.rd < before.rd


def test_new_player_moves_further_than_veteran():
    """The whole point of RD: high uncertainty means fast convergence."""
    newbie = Rating(1500, 350, 0.06)
    veteran = Rating(1500, 50, 0.06)
    opponent = Rating(1500, 50)
    newbie_delta = update_duel(newbie, opponent, WIN).rating - 1500
    veteran_delta = update_duel(veteran, opponent, WIN).rating - 1500
    assert newbie_delta > veteran_delta * 2


def test_draw_between_equals_barely_moves():
    r = update_duel(Rating(1500, 50), Rating(1500, 50), DRAW)
    assert abs(r.rating - 1500) < 1.0


def test_no_games_grows_uncertainty_only():
    before = Rating(1600, 80, 0.06)
    after = update(before, [])
    assert after.rating == before.rating     # rating unchanged
    assert after.rd > before.rd              # but we are less sure of it
