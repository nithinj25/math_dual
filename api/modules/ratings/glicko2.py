import math
from dataclasses import dataclass

SCALE = 173.7178          # Glicko-2 internal scale factor
BASE_RATING = 1500.0
BASE_RD = 350.0
BASE_VOLATILITY = 0.06
TAU = 0.5                 # system constant, per DESIGN.md 3.5
EPSILON = 1e-6            # convergence threshold for the volatility solver

WIN, DRAW, LOSS = 1.0, 0.5, 0.0


@dataclass(frozen=True)
class Rating:
    rating: float = BASE_RATING
    rd: float = BASE_RD
    volatility: float = BASE_VOLATILITY


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi ** 2))


def _expected(mu: float, mu_j: float, phi_j: float) -> float:
    return 1.0 / (1.0 + math.exp(-_g(phi_j) * (mu - mu_j)))


def update(player: Rating, results: list[tuple[Rating, float]]) -> Rating:
    """Apply one rating period's results. `results` is [(opponent, score), ...]
    where score is WIN / DRAW / LOSS."""
    if not results:
        # no games played: rating and volatility hold, uncertainty grows
        phi = player.rd / SCALE
        phi_star = math.sqrt(phi * phi + player.volatility ** 2)
        return Rating(player.rating, min(SCALE * phi_star, BASE_RD), player.volatility)

    mu = (player.rating - BASE_RATING) / SCALE
    phi = player.rd / SCALE

    v_inv = 0.0
    delta_sum = 0.0
    for opponent, score in results:
        mu_j = (opponent.rating - BASE_RATING) / SCALE
        phi_j = opponent.rd / SCALE
        g_j = _g(phi_j)
        e_j = _expected(mu, mu_j, phi_j)
        v_inv += g_j * g_j * e_j * (1.0 - e_j)
        delta_sum += g_j * (score - e_j)

    v = 1.0 / v_inv
    delta = v * delta_sum

    volatility = _solve_volatility(phi, v, delta, player.volatility)

    phi_star = math.sqrt(phi * phi + volatility * volatility)
    phi_prime = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
    mu_prime = mu + phi_prime * phi_prime * delta_sum

    return Rating(BASE_RATING + SCALE * mu_prime, SCALE * phi_prime, volatility)


def _solve_volatility(phi: float, v: float, delta: float, sigma: float) -> float:
    """Illinois-method root find from Glickman's paper, step 5."""
    a = math.log(sigma * sigma)

    def f(x: float) -> float:
        ex = math.exp(x)
        num = ex * (delta * delta - phi * phi - v - ex)
        den = 2.0 * (phi * phi + v + ex) ** 2
        return num / den - (x - a) / (TAU * TAU)

    A = a
    if delta * delta > phi * phi + v:
        B = math.log(delta * delta - phi * phi - v)
    else:
        k = 1
        while f(a - k * TAU) < 0:
            k += 1
        B = a - k * TAU

    fA, fB = f(A), f(B)
    while abs(B - A) > EPSILON:
        C = A + (A - B) * fA / (fB - fA)
        fC = f(C)
        if fC * fB <= 0:
            A, fA = B, fB
        else:
            fA = fA / 2.0
        B, fB = C, fC

    return math.exp(A / 2.0)


def update_duel(player: Rating, opponent: Rating, score: float) -> Rating:
    """Convenience for a 1v1 duel — exactly one opponent."""
    return update(player, [(opponent, score)])
