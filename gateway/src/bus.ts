import { Redis } from "ioredis";

const URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6380";

// Two connections on purpose: a Redis client in subscriber mode cannot
// run normal commands, so publishing needs its own.
const sub = new Redis(URL);
const pub = new Redis(URL);

export interface Envelope {
    to: string;
    msg: object;
}

type Handler = (env: Envelope) => void;

const handlers = new Map<string, Handler> ();

sub.on("message", (channel, raw) => {
   const handler = handlers.get(channel);
   if(!handler) return;
   try{
    handler(JSON.parse(raw) as Envelope);
   }
   catch(err){
    console.error(`[bus] bad payload on ${channel}:`, err);
   }
});

export function channelFor(matchId: string): string{
    return `match:${matchId}`;
}

export async function subscribe(matchId: string, handler: Handler): Promise<void> {
    const ch =channelFor(matchId);
    if(handlers.has(ch)) return;
    handlers.set(ch, handler);
    await sub.subscribe(ch);
}

export async function unsubscribe(matchId: string): Promise<void> {
    const ch = channelFor(matchId);
    if(!handlers.delete(ch)) return;
    await sub.unsubscribe(ch);
}

export async function publish(matchId: string, env: Envelope): Promise<void> {
    await pub.publish(channelFor(matchId), JSON.stringify(env));
}

export async function closeBus(): Promise<void> {
    await Promise.all([sub.quit(), pub.quit()]);
}