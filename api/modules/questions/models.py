from dataclasses import dataclass, field

@dataclass(frozen=True)
class Questions:
    q_index: int
    template: str
    prompt: str
    answer: int
    bucket_tags: list[str] = field(default_factory=list)
    
