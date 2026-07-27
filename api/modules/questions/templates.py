""""One generator function per question template. Each takes the seeded
RNG and that bucket's config dict, returns (prompt, answer, tags)"""

import random

def _digits(n: int, width: int) -> list[int]:
    return [int(c) for c in str(n).zfill(width)]

def _has_carry(a: int , b: int) -> bool:
    width = max(len(str(a)), len(str(b)))
    da, db = _digits(a, width) , _digits(b, width)
    carry = 0
    for i in range(width - 1, -1, -1):
        s = da[i] + db[i] + carry
        carry = 1 if s >= 10 else 0
        if carry: 
            return True
    
    return False

def _has_borrow(a: int, b: int) -> bool:
    #assumes a >= b
    width = len(str(a))
    da, db = _digits(a, width) , _digits(b, width)
    borrow = 0
    for i in range(width - 1, -1, -1):
        if(da[i] - borrow - db[i] < 0):
            return True
        borrow = 0
        
    return False

def gen_add_sub(rng: random.Random, bucket: dict) -> tuple[str, int, list[str]]:
    d1, d2 = bucket["digits"]
    carry_required = bucket.get("carryRequired", False)
    lo1, hi1 = 10 ** (d1 - 1), 10 ** d1 - 1
    lo2, hi2 = 10 ** (d2 - 1), 10 ** d2 - 1
    
    while True:
        a = rng.randint(lo1, hi1)
        b = rng.randint(lo2, hi2)
        op = rng.choice(["+", "-"])
        needs_carry = _has_carry(a, b) if op == "+" else _has_borrow(max(a, b), min(a, b))
        if carry_required and not needs_carry:
            continue
        break

    if op == "+":
        return f"{a} + {b}", a + b, ["add_sub", "carry" if needs_carry else "no_carry"]
    hi, lo = max(a, b), min(a, b)
    return f"{hi} - {lo}", hi - lo, ["add_sub", "borrow" if needs_carry else "no_borrow"]

def gen_multiply(rng: random.Random, bucket: dict) -> tuple[str, int, list[str]]:
    d1, d2 = bucket["digits"]
    lo1, hi1 = 10 ** (d1 - 1), 10 ** d1 - 1
    lo2, hi2 = 10 ** (d2 - 1), 10 ** d2 - 1
    a = rng.randint(lo1, hi1)
    b = rng.randint(lo2, hi2)
    return f"{a} × {b}", a * b, ["multiply"]


def gen_divide(rng: random.Random, bucket: dict) -> tuple[str, int, list[str]]:
    # only "exact": true is implemented — the only value the given configs use
    divisor_digits = bucket["divisorDigits"]
    lo, hi = 10 ** (divisor_digits - 1), 10 ** divisor_digits - 1
    divisor = rng.randint(lo, hi)
    quotient = rng.randint(2, 20)
    dividend = divisor * quotient
    return f"{dividend} ÷ {divisor}", quotient, ["divide"]


def gen_square(rng: random.Random, bucket: dict) -> tuple[str, int, list[str]]:
    n = rng.randint(2, bucket["max"])
    return f"{n}²", n * n, ["square"]


def gen_percent(rng: random.Random, bucket: dict) -> tuple[str, int, list[str]]:
    percents = [10, 20, 25, 50, 75] if bucket.get("ofRound") else list(range(1, 100))
    pct = rng.choice(percents)
    base = rng.randint(1, 20) * 20
    return f"{pct}% of {base}", base * pct // 100, ["percent"]


GENERATORS = {
    "add_sub": gen_add_sub,
    "multiply": gen_multiply,
    "divide": gen_divide,
    "square": gen_square,
    "percent": gen_percent,
}