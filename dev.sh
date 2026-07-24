#!/usr/bin/env bash
# One-command dev bring-up: infra in docker, api + gateway on the host.
set -e

docker compose up -d
echo "waiting for postgres + redis..."
until docker compose exec -T postgres pg_isready -U mathduel >/dev/null 2>&1; do sleep 1; done
until docker compose exec -T redis redis-cli ping >/dev/null 2>&1; do sleep 1; done

trap 'kill 0' EXIT

(cd api && uvicorn main:app --reload --port 8000) &
(cd gateway && npm run dev) &
wait
