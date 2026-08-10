/** The DESIGN.md 3.2 protocol, typed. Every frame the gateway can send is
 *  represented here, and every one of them is rendered somewhere in the UI. */

export type ServerMsg =
  | { t: "waiting"; window?: number }
  | { t: "matched"; matchId: string; opponent: { name: string }; tier: string }
  | { t: "countdown"; startsInMs: number }
  | { t: "question"; qIndex: number; prompt: string; servedTs: number }
  | { t: "result"; qIndex: number; correct: boolean; yourScore: number; oppScore: number }
  | { t: "opp"; qIndex: number; oppAnswered: boolean }
  | { t: "rejected"; reason: string }
  | { t: "end"; winner: "you" | "them" | "draw"; score: [number, number]; ratingDelta: number };

export type ClientMsg =
  | { t: "join"; token: string }
  | { t: "answer"; qIndex: number; value: number };

export type Status = "idle" | "connecting" | "open" | "closed";

export interface Frame {
  id: number;
  dir: "in" | "out";
  t: string;
  at: number;
  body: unknown;
}

const GATEWAY = (import.meta.env.VITE_GATEWAY_URL as string) ?? "ws://127.0.0.1:8080";

export interface SocketHooks {
  token: string;
  onMsg: (m: ServerMsg) => void;
  onStatus: (s: Status, attempt: number) => void;
  onFrame?: (f: Frame) => void;
}

let frameSeq = 0;

export class DuelSocket {
  private ws: WebSocket | null = null;
  private closedByUs = false;
  private attempt = 0;
  private retryTimer: number | undefined;
  private hooks: SocketHooks;

  constructor(hooks: SocketHooks) {
    this.hooks = hooks;
  }

  private frame(dir: "in" | "out", t: string, body: unknown) {
    this.hooks.onFrame?.({ id: ++frameSeq, dir, t, at: Date.now(), body });
  }

  connect() {
    this.hooks.onStatus("connecting", this.attempt);
    const ws = new WebSocket(GATEWAY);
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.hooks.onStatus("open", 0);
      this.send({ t: "join", token: this.hooks.token });
    };

    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data) as ServerMsg;
      } catch {
        console.warn("unparseable frame", e.data);
        return;
      }
      this.frame("in", msg.t, msg);
      this.hooks.onMsg(msg);
    };

    ws.onclose = () => {
      if (this.closedByUs) return this.hooks.onStatus("idle", 0);
      this.hooks.onStatus("closed", this.attempt);
      // The gateway is stateless, so rejoining with the same token resumes
      // the match wherever it left off — even on a different instance.
      const wait = Math.min(800 * 2 ** this.attempt, 8000);
      this.attempt += 1;
      this.retryTimer = window.setTimeout(() => this.connect(), wait);
    };

    ws.onerror = () => ws.close();
  }

  private send(msg: ClientMsg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    this.frame("out", msg.t, msg);
    return true;
  }

  answer(qIndex: number, value: number) {
    return this.send({ t: "answer", qIndex, value });
  }

  get live() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    this.ws?.close();
    this.hooks.onStatus("idle", 0);
  }
}
