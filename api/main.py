import logging 
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from modules.game.router import router as duel_router
from db import connect, disconnect
from modules.auth.dependencies import get_current_user

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("mathduel.api")

@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect()
    log.info("connected: postgress + redis")
    yield
    await disconnect()
    
app = FastAPI(title="MathDuel API", lifespan=lifespan)
app.include_router(duel_router)

@app.get("/health")
async def health():
    return {"status": "ok"}

@app.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user
