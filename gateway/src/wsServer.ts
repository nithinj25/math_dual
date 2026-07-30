import { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { DuelRoom, Player } from "./duelRoom.js";

const HEARTBEAT_INTERVAL_MS = 10_000;

export function startWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });

  const players = new Map<WebSocket, Player>();
  const rooms = new Map<WebSocket, DuelRoom>();
  let waiting: Player | null = null;

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    console.log(`[open]  (${players.size + 1} connected) from ${req.socket.remoteAddress}`);

    socket.on("pong", () => {
      const p = players.get(socket);
      const room = rooms.get(socket);
      if (p && room) room.onPong(p).catch(console.error);
    });

    socket.on("message", async (data: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return socket.send(JSON.stringify({ t: "rejected", reason: "not JSON"}));
      }

      if(msg.t === "join"){
        if(players.has(socket)) return;
        const player: Player = {
          id: msg.name ?? `p_${randomUUID().slice(0, 6)}`,
          socket, rttMs: 0, lastPingAt: Date.now(),
        };

        players.set(socket, player);
        console.log(`[join] ${player.id}`);

        if(waiting === null){
          waiting = player;
          socket.send(JSON.stringify({ t: "waiting"}));
        }
        else{
          const pair = [waiting, player];
          waiting = null;
          const room = new DuelRoom(`m_${randomUUID().slice(0, 6)}`, pair);
          for (const p of pair) rooms.set(p.socket, room);
          console.log(`[match] ${pair[0].id} vs ${pair[1].id}`);
          room.start().catch(console.error);
        }
        return;
      }
      if(msg.t === "answer"){
        const p = players.get(socket);
        const room  = rooms.get(socket);
        if(!p || !room){
          return socket.send(JSON.stringify({ t: "rejected", reason: "not in a match" }));
        }
        await room.onAnswer(p, { qIndex: msg.qIndex, value: msg.value});
        return;
      }
      socket.send(JSON.stringify({ t: "rejected", reason: `unknown type ${msg.t}` }));
    });

    socket.on("close", (code: number) => {
      const p = players.get(socket);
      if(waiting && p && waiting.id === p.id) waiting = null;
      players.delete(socket);
      rooms.delete(socket);
      console.log(`[close] ${p?.id ?? "?"} code=${code} (${players.size}) connected`);
    });

    socket.on("error", (err: Error) => console.error(`[error] ${err.message}`));
  });

  const heartbeat = setInterval(() => {
    for(const [socket, player] of players) {
      if(socket.readyState !== WebSocket.OPEN) continue;
      player.lastPingAt = Date.now();
      socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  console.log(`ws gateway listening on : ${port}`);
  return wss;
}