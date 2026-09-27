#!/usr/bin/env node
//
// Mints HS256 tokens that a host running AUTH_MODE=fake will accept.
//
//   CONFIRM_STAGING=yes FAKE_AUTH_SECRET=... N=500 node mint-tokens.mjs
//
// There is deliberately no Supabase in here. The API already has a fake-auth
// path (api/modules/auth/token.py), so load tests do not need the admin API,
// a service-role key, or to fight a sign-in rate limit. Distinct `sub` values
// are enough: get_or_create_user creates the users row on first resolve.
//
// No dependencies — an HS256 JWT is a signed pair of base64url blobs, and
// node:crypto is in the standard library.

import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";

const {
  FAKE_AUTH_SECRET,
  N = "500",
  AUD = "authenticated",
  TTL_SECONDS = "21600",
  OUT = "tokens.json",
  CONFIRM_STAGING,
} = process.env;

// These are forged credentials. They are worthless against production, which
// verifies real Supabase signatures — but the guard makes the intent explicit
// and stops a stray run from writing tokens someone later points anywhere.
if (CONFIRM_STAGING !== "yes") {
  console.error(
    "Refusing to run.\n\n" +
      "These tokens only work on a host running AUTH_MODE=fake. Set\n" +
      "CONFIRM_STAGING=yes once you are certain you are pointing at staging.",
  );
  process.exit(1);
}

if (!FAKE_AUTH_SECRET) {
  console.error("FAKE_AUTH_SECRET is required and must match the staging host's .env");
  process.exit(1);
}

// The literal token.py expects in fake mode. Not configurable there, so not here.
const ISSUER = "fake-issuer";

const b64url = (input) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

function sign(claims) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = b64url(
    createHmac("sha256", FAKE_AUTH_SECRET).update(signingInput).digest(),
  );
  return `${signingInput}.${signature}`;
}

const now = Math.floor(Date.now() / 1000);
const count = Number(N);
const tokens = [];

for (let i = 0; i < count; i++) {
  // One distinct player per token. Two VUs sharing a subject would be the
  // same user twice: the gateway would overwrite its own byUser entry and
  // matchmaking would try to pair someone with themselves.
  tokens.push(
    sign({
      sub: `loadtest-${i}`,
      email: `lt${i}@loadtest.invalid`,
      iss: ISSUER,
      aud: AUD,
      iat: now,
      exp: now + Number(TTL_SECONDS),
    }),
  );
}

writeFileSync(OUT, JSON.stringify(tokens));
console.log(
  `wrote ${tokens.length} tokens to ${OUT}, valid for ${TTL_SECONDS}s ` +
    `(${(Number(TTL_SECONDS) / 3600).toFixed(1)}h)`,
);
console.log(`run k6 with at most ${tokens.length} VUs, or mint more`);
