import logging 
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

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
