BEGIN;

CREATE TABLE leaderboard_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    tier        TEXT NOT NULL,
    scope       TEXT NOT NULL,          -- 'global' or an ISO week like '2026-W31'
    user_id     UUID NOT NULL REFERENCES users(id),
    points      DOUBLE PRECISION NOT NULL,
    rank        INT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX leaderboard_snapshots_lookup_idx
    ON leaderboard_snapshots (tier, scope, captured_at DESC);

COMMIT;
