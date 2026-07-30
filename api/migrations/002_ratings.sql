-- Wrapped in a transaction so a failure part-way through leaves nothing
-- behind. psql does not do this for you: without BEGIN/COMMIT, each
-- statement commits on its own and a typo halfway down leaves a
-- half-migrated database.
BEGIN;

CREATE TABLE ratings (
    user_id      UUID NOT NULL REFERENCES users(id),
    tier         TEXT NOT NULL,
    rating       DOUBLE PRECISION NOT NULL DEFAULT 1500,
    rd           DOUBLE PRECISION NOT NULL DEFAULT 350,
    volatility   DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    games_played INT NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tier)
);

CREATE TABLE matches (
    id                  TEXT PRIMARY KEY,
    tier                TEXT NOT NULL,
    seed                BIGINT NOT NULL,
    tier_config_version INT NOT NULL DEFAULT 1,
    p1                  UUID NOT NULL REFERENCES users(id),
    p2                  UUID NOT NULL REFERENCES users(id),
    p2_is_bot           BOOLEAN NOT NULL DEFAULT FALSE,
    winner              UUID REFERENCES users(id),   -- NULL means draw
    p1_score            INT NOT NULL,
    p2_score            INT NOT NULL,
    status              TEXT NOT NULL,
    started_at          TIMESTAMPTZ,
    ended_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rating_history (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    match_id        TEXT NOT NULL REFERENCES matches(id),
    tier            TEXT NOT NULL,
    rating_before   DOUBLE PRECISION NOT NULL,
    rating_after    DOUBLE PRECISION NOT NULL,
    rd_after        DOUBLE PRECISION NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rating_history_user_idx ON rating_history (user_id, created_at DESC);

COMMIT;
