import "dotenv/config";
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");

async function main() {
  await redis.ping();
  console.log("connected: redis");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
