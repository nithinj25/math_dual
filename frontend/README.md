# MathDuel — web client

React + TypeScript + Vite. Talks to two things: the FastAPI service over HTTP,
and the websocket gateway for anything that happens inside a match.

```bash
cp .env.example .env      # Supabase keys, API url, gateway url
npm install
npm run dev               # http://localhost:5173
```

The API must allow this origin. It reads `CORS_ORIGINS` (comma separated) and
defaults to `http://localhost:5173,http://127.0.0.1:5173`.

## What is where

```
src/
  App.tsx            state machine: auth → lobby → queue → duel → result
  lib/api.ts         every HTTP endpoint, plus a call log other views subscribe to
  lib/socket.ts      the gateway protocol, typed; reconnects with backoff
  lib/duel.ts        the shape of a live duel and the two constants that matter
  lib/hooks.ts       useNow, useCountUp, usePolled
  screens/           Landing, Lobby, Queue, Duel, Result, Leaderboard, System
  components/        Header, ClockRing, Keypad, Toasts, ProtocolLog
  three/Arena.tsx    the shader field behind everything
  index.css          design tokens, reset, primitives
  App.css            screen styles
```

## Two rules the client sticks to

**Nothing is computed locally.** Scores, question index, correctness and the
winner all come off the wire. The only local arithmetic is for drawing clocks —
the countdown, the 120 second match ring, and per-question solve time, which is
measured from when the frame arrived rather than from the server's `servedTs`
so a skewed client clock cannot show nonsense.

**Everything the API offers is reachable.** The Lobby shows queue depth per
tier, your standing on each board and whether you have a match to rejoin. The
System screen covers health, queue sizes, the room inspector and the two
operational board endpoints (rebuild, snapshot). The protocol drawer — bottom
right, on every screen — shows live websocket frames in both directions and
every HTTP call with its status and latency.
