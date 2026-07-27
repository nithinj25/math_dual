import json
from pathlib import Path

from .generator import generate_questions

CONFIG = json.loads((Path(__file__).parent / "tier_configs" / "intermediate.json").read_text())

def test_same_seed_is_identical():
    a = generate_questions(12345, CONFIG)
    b = generate_questions(12345, CONFIG)
    assert a == b
    

def test_different_seed_differs():
    a = generate_questions(12345, CONFIG)
    b = generate_questions(123456, CONFIG)
    assert a != b
    
