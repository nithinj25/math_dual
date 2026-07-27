import { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

const HEARTBEAT_INTERVAL_MS = 30_000;

// Our own per-connection state. `ws` doesn't give us this, so we attach it.
interface Client {
  id: string;
  socket: WebSocket;
  isAlive: boolean;
}

export function startWsServer(port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });
  const clients = new Map<WebSocket, Client>();

  wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const client: Client = { id: randomUUID(), socket, isAlive: true };
    clients.set(socket, client);
    console.log(`[open]  ${client.id}  (${clients.size} connected)  from ${req.socket.remoteAddress}`);

    // pong is the client's reply to our ping — proof the socket is still alive.
    socket.on("pong", () => {
      client.isAlive = true;
    });

    socket.on("message", (data: Buffer, isBinary: boolean) => {
      console.log(`[msg]   ${client.id}  ${data.toString()}`);
      socket.send(data, { binary: isBinary }); // echo
    });

    socket.on("close", (code: number) => {
      clients.delete(socket);
      console.log(`[close] ${client.id}  code=${code}  (${clients.size} connected)`);
    });

    socket.on("error", (err: Error) => {
      console.error(`[error] ${client.id}  ${err.message}`);
    });
  });

  // Heartbeat sweep: reap any socket that didn't pong since the last sweep.
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.isAlive) {
        console.log(`[reap]  ${client.id}  (no pong)`);
        client.socket.terminate();
        continue;
      }
      client.isAlive = false; // will be flipped back true by the pong handler
      client.socket.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  console.log(`ws gateway listening on :${port}`);
  return wss;
}
