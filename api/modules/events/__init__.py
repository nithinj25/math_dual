# M9 — Kafka event log. See DESIGN.md §4.3.
from .producer import TOPIC_ANSWERS, TOPIC_MATCHES, emit, start, stop

__all__ = ["emit", "start", "stop", "TOPIC_ANSWERS", "TOPIC_MATCHES"]
