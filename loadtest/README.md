# Load testing

How many concurrent players does MathDuel hold on the box it actually runs on,
and what breaks first?

One k6 virtual user is one whole player: loads the app, opens a WebSocket,
queues, gets paired by the real matchmaker, answers twenty questions with
human-ish think time, receives the end frame, then loops into another duel.

> **Never run this against production.** Not because of users, but because the
> numbers would be meaningless — you would be measuring a box that is also
> serving the test — and bot matches permanently pollute the Glicko-2 ladder
> and the `matches` table.

---

## Why two machines

| | Size | Why |
|---|---|---|
| **staging** | `Standard_B2als_v2` — 2 vCPU / 4 GiB | **Must match production exactly.** Test a different box and you learn nothing about the real one |
| **loadgen** | `Standard_B2as_v2` — 2 vCPU / 8 GiB | Must never itself be the bottleneck. Never run k6 on the machine under test |

Both in `centralindia`, the same region as production, so the measured round
trip is the server rather than the internet. Running k6 from a laptop adds
30–60 ms to every sample and makes a `p95 < 150 ms` threshold meaningless.

Roughly **$0.07/hour for the pair** — a six-hour session is about $0.45.

---

## 1. Create the machines

In **Azure Cloud Shell** (the `>_` icon in the portal — `az` is already signed
in as you):

```bash
RG=mathduel-loadtest
LOC=centralindia
KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICv9Zepr1ntM317H5qpzsSa/7LGQEK2i0O3YN+rp+/ZQ oracle-mathduel"

az group create --name $RG --location $LOC

az vm create --resource-group $RG --name staging \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --size Standard_B2als_v2 \
  --admin-username azureuser --ssh-key-values "$KEY" \
  --storage-sku StandardSSD_LRS --os-disk-size-gb 30 \
  --public-ip-sku Standard --nsg-rule SSH --output table

az vm open-port --resource-group $RG --name staging --port 80  --priority 1001
az vm open-port --resource-group $RG --name staging --port 443 --priority 1002

az vm create --resource-group $RG --name loadgen \
  --image Canonical:ubuntu-24_04-lts:server:latest \
  --size Standard_B2as_v2 \
  --admin-username azureuser --ssh-key-values "$KEY" \
  --storage-sku StandardSSD_LRS --os-disk-size-gb 30 \
  --public-ip-sku Standard --nsg-rule SSH --output table

az vm list-ip-addresses --resource-group $RG --output table
```

A dedicated resource group matters: it means cleanup is one command that
**cannot** touch production, which lives in `mathduel_group`.

Belt and braces against a forgotten VM eating your credit (times are UTC):

```bash
az vm auto-shutdown --resource-group $RG --name staging --time 2000
az vm auto-shutdown --resource-group $RG --name loadgen --time 2000
```

## 2. DNS

Two A records at Namecheap, both pointing at the **staging** public IP:

| Type | Host | Value |
|---|---|---|
| A | `staging` | *staging public IP* |
| A | `www.staging` | *staging public IP* |

The second exists only because the Caddyfile asks for a certificate for
`www.{$DOMAIN}`; without it Caddy logs a failure on every start.

## 3. Deploy the stack to staging

```bash
ssh azureuser@STAGING_IP
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker azureuser
exit
```

Reconnect, then:

```bash
git clone https://github.com/nithinj25/math_dual.git
cd math_dual && git checkout frontend-rebuild

FAKE_SECRET=$(openssl rand -base64 24)
cat > .env <<EOF
DOMAIN=staging.mathduel.me
POSTGRES_PASSWORD=$(openssl rand -hex 24)

AUTH_MODE=fake
ENVIRONMENT=staging
FAKE_AUTH_SECRET=$FAKE_SECRET

VITE_SUPABASE_URL=https://placeholder.supabase.co
VITE_SUPABASE_ANON_KEY=placeholder
SUPABASE_JWT_ISSUER=https://placeholder.supabase.co/auth/v1
SUPABASE_JWKS_URL=https://placeholder.supabase.co/auth/v1/.well-known/jwks.json
EOF

echo "FAKE_AUTH_SECRET=$FAKE_SECRET"   # you need this on loadgen

docker compose -f docker-compose.prod.yml up -d --build
```

`-hex` matters for the Postgres password: it lands inside `DATABASE_URL`,
and the `+` and `/` that base64 produces break DSN parsing. The fake auth
secret never goes in a URL, so base64 is fine there.

The Supabase values are placeholders — unused in fake mode, but Compose
requires them to be set. `AUTH_MODE=fake` is what lets the load test mint its
own tokens; `token.py` refuses to load in fake mode when `ENVIRONMENT` is
`production`, so this combination is impossible to reach by accident on a real
deployment.

Raise the file-descriptor limit before testing:

```bash
echo "* soft nofile 65535" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65535" | sudo tee -a /etc/security/limits.conf
```

Verify: `curl -s https://staging.mathduel.me/api/health` → `{"status":"ok"}`

## 4. Set up the load generator

```bash
ssh azureuser@LOADGEN_IP

sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 \
  --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install -y k6 nodejs

echo "* soft nofile 65535" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65535" | sudo tee -a /etc/security/limits.conf

git clone https://github.com/nithinj25/math_dual.git
cd math_dual/loadtest
```

## 5. Mint tokens

One token per virtual user — two VUs sharing a subject would be the same
player twice, and matchmaking would try to pair someone with themselves.

```bash
CONFIRM_STAGING=yes \
FAKE_AUTH_SECRET='<the secret printed on staging>' \
N=500 node mint-tokens.mjs
```

`tokens.json` is gitignored. It is credentials — never commit it.

## 6. Smoke test, then ramp

Always smoke first. Confirm duels actually complete before spending an hour
on a ramp that was never going to work:

```bash
k6 run --vus 10 --duration 2m \
  -e BASE_URL=https://staging.mathduel.me \
  -e WS_URL=wss://staging.mathduel.me/ws \
  mathduel-duel.js
```

`duels_completed` must be non-zero and `frames_rejected` near zero. If duels
never complete, the script and the protocol have drifted — fix that before
scaling.

Then the full ramp:

```bash
k6 run -e BASE_URL=https://staging.mathduel.me \
       -e WS_URL=wss://staging.mathduel.me/ws \
       mathduel-duel.js
```

| Env var | Default | |
|---|---|---|
| `WRONG_RATE` | `0.15` | Fraction answered wrong, so losses and rating drops are exercised |
| `THINK_MIN_MS` / `THINK_MAX_MS` | `1500` / `4000` | Human think time |
| `WATCHDOG_MS` | `180000` | Give-up point for a single duel |

## 7. What to watch, on staging, during the run

```bash
docker stats                      # per-container CPU and memory
vmstat 1                          # the `st` column is stolen CPU — a noisy neighbour
docker compose -f docker-compose.prod.yml logs -f gateway | grep -i error
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U mathduel -d mathduel -c \
  "SELECT state, count(*) FROM pg_stat_activity GROUP BY state;"
docker compose -f docker-compose.prod.yml exec -T redis redis-cli --latency
```

**Predicted first bottleneck:** the gateway polls
`POST /internal/matchmaking/join` once per second for every waiting player,
and each poll runs a Postgres query in `rating_and_tier()`. 500 players queued
is 500 Postgres round trips per second re-reading ratings that have not
changed. Watch `pg_stat_activity` climb as queue depth grows.

**Second:** every answer costs two API calls — one to submit, one to fetch the
next question — against a **single** uvicorn process, because live duels live
in that process's memory.

## 8. Clean up — do not skip this

```bash
az group delete --name mathduel-loadtest --yes --no-wait
```

Deletes both VMs, their disks, IPs and NICs. Production is in a different
resource group and is not touched. Two forgotten VMs cost about $54/month,
which would halve the remaining Azure credit.

---

## Results

Run against a `Standard_B2als_v2` (2 vCPU / 4 GiB, Central India) sized
identically to production, with k6 on a separate VM in the same region.
Sessions are 20-question duels with 1.5-4s think time per answer.

| Run | VUs | Answer RTT p95 | Answer RTT p99 | Duels failed | HTTP p95 | Match wait p95 | Verdict |
|---|---|---|---|---|---|---|---|
| 0 smoke | 10 | 5ms | 7.8ms | 0% | 21.7ms | 61s | pass, bar match wait |
| 1 ramp | **400** | **13ms** | 287ms | **0.07%** | 14.3ms | 6.04s | pass, bar match wait |
| 2 ramp | 1200 | 357ms | 826ms | 82.3% | 40.5ms | 2.02s | **invalid** - harness bug |

Run 1 sustained **1,387 completed duels, 28,622 answers and 92,408 WebSocket
messages** with an answer round trip of 13ms at p95.

### The ceiling was not found

400 VUs passed every threshold except match wait, and answer latency had moved
only 5ms to 13ms from idle. Run 2 was meant to find the limit and instead hit a
bug in the load script (see below), so **the real capacity is somewhere above
400 concurrent players and remains unmeasured.**

### The match-wait failures were not the server

Match wait was the only failing threshold in runs 0 and 1, and it is not a
throughput problem.

At 10 VUs the distribution was bimodal with a slow mode at exactly one duel
length: every bot finished together and re-queued in lockstep, so whoever was
left unpaired waited a whole duel for a partner. At 400 VUs the p95 of 6s
corresponds to the rating window widening to about +/-150, which is the
matchmaker deliberately trading match quality for speed after a few seconds of
waiting - the bots had played 1,387 rated games in ten minutes and Glicko-2 had
spread them across all three tiers.

The clinching evidence is run 2: at 1200 VUs match wait *improved* to 2.02s. A
denser queue pairs faster. Slowness was never the cause.

### A prediction that was wrong

Before running anything, the expectation was that matchmaking polling would
saturate Postgres first: the gateway polls `/internal/matchmaking/join` once a
second for every waiting player, and each poll runs a `SELECT` in
`rating_and_tier()`.

It did not come close. HTTP p95 held at 14ms through 400 VUs and 40ms through
the invalid 1200-VU run, with a 0.2% error rate at worst. The polling design is
wasteful and worth fixing on its own merits, but it is not the binding
constraint at this scale.

### Why run 2 is invalid

The script indexed tokens with `tokens[(__VU - 1) % tokens.length]` and only 500
tokens had been minted for 1200 VUs. VUs 501-1200 reused earlier tokens, which
means several virtual users shared one player identity - and the gateway keeps
one socket per user id while `room_of_player` returns the same match for both.
They evicted each other from their own duels.

The result read like a dramatic server failure (82% of duels failed, 9,526
frames rejected) while every server-side signal stayed healthy. Duels with
`min=3ms` gave it away. The script now refuses to start with fewer tokens than
VUs.

### Bugs this exercise found

| Where | Bug |
|---|---|
| Deployment docs | `openssl rand -base64` for the Postgres password emits `+` and `/`, which break DSN parsing and stop the API from starting. Production had survived on luck |
| Load script | Token index wrapped, letting VUs share a player identity |
| Load script | Virtual players arrived in lockstep, manufacturing a match-wait figure that looked like a server problem |
| Load script | Pending think timers were never cancelled, so k6 logged thousands of warnings and buried the summary |

### Next

1. Re-run the 1200-VU ramp now the token guard is in, with `docker stats`
   captured during the 800 and 1200 stages
2. Push past 1200 until something genuinely breaks
3. Only then optimise, one change per run - most likely candidates being the
   matchmaking poll, then moving duel state to Redis so the API can run more
   than one process

**Capacity** = the highest VU count at which every threshold in
`mathduel-duel.js` still passes. Change one thing per run, or you will not know
which change moved the number.
