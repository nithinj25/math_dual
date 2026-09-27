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
POSTGRES_PASSWORD=$(openssl rand -base64 24)

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

| Run | Change | Max VUs passing | p95 answer RTT | p99 answer RTT | CPU % | Steal % | First thing that broke |
|---|---|---|---|---|---|---|---|
| 0 | Baseline | | | | | | |

**Capacity** = the highest VU count at which every threshold in
`mathduel-duel.js` still passes. Change one thing per run, or you will not
know which change moved the number.
