import "dotenv/config";
import { Redis } from "ioredis";
import { startWsServer } from "./wsServer.js";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const WS_PORT = Number(process.env.WS_PORT ?? 8080);

async function main() {
  await redis.ping();
  console.log("connected: redis");
  startWsServer(WS_PORT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


