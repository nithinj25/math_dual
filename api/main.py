import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from modules.game.router import router as duel_router
from modules.auth.router import router as auth_router
from modules.leaderboard.router import router as leaderboard_router
from modules.matchmaking.router import router as matchmaking_router
from db import connect, disconnect
from modules.auth.dependencies import get_current_user
from modules.events import start as kafka_start, stop as kafka_stop

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mathduel.api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    await kafka_start()          # tolerates Kafka being down
    log.info("connected: postgres + redis")
    yield
    await kafka_stop()
    await disconnect()

app = FastAPI(title="MathDuel API", lifespan=lifespan)

# The browser talks to this API directly (leaderboard, /me, queue sizes), so
# without this every fetch from the web app fails the preflight. Origins are
# explicit rather than "*" because /me is called with a bearer token.
ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(duel_router)
app.include_router(auth_router)
app.include_router(leaderboard_router)
app.include_router(matchmaking_router)


@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user
