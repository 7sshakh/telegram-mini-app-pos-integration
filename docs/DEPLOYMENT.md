# Deployment guide

## 0. Prerequisites

* Node.js 20+
* A Postgres database (Neon, Supabase, RDS, or your own VPS Postgres)
* A domain with HTTPS (Telegram requires HTTPS for Mini Apps)
* The POS computer with outbound internet access (the agent only makes **outgoing** requests)

---

## 1. Environment variables (production)

```env
NODE_ENV=production
APP_BASE_URL=https://mini.vibe.uz
DATABASE_URL=postgresql://user:pass@host:5432/vibe?sslmode=require

SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(32).toString('hex'))">
ADMIN_API_TOKEN=<node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))">

TELEGRAM_BOT_TOKEN=123456:AA…
TELEGRAM_BOT_USERNAME=vibe_orders_bot
TELEGRAM_NOTIFY=true

POS_MODE=pos
ALLOW_MOCK_FALLBACK=false
DEV_MODE=false
ALLOW_UNVERIFIED_INITDATA=false

CATALOG_TTL_SECONDS=90
BRIDGE_POLL_SECONDS=25
BRIDGE_JOB_LEASE_SECONDS=60
BRIDGE_MAX_ATTEMPTS=30

PAYMENT_PROVIDER=manual          # or payme | click | stripe
# + the provider credentials, server side only
```

**Security checklist**

| Check | Why |
| --- | --- |
| `DEV_MODE=false` | disables `/api/dev/login` |
| `ALLOW_UNVERIFIED_INITDATA=false` | Telegram logins must be signature-verified |
| `ALLOW_MOCK_FALLBACK=false` | never serve demo data to real customers |
| `SESSION_SECRET` ≥ 32 bytes | session tokens must not be forgeable |
| `ADMIN_API_TOKEN` ≥ 24 chars | protects device registration & queue control |
| No `0.0.0.0` binding on the POS | the POS adapter stays on `127.0.0.1` |
| `robots: noindex` (already set) | keep the Mini App out of search engines |

---

## 2. Database migration

```bash
# development / staging: apply the schema directly
npx drizzle-kit push

# production: generate SQL, review it, then migrate
npx drizzle-kit generate      # writes ./drizzle/NNNN_*.sql
npx drizzle-kit migrate       # applies them in order
```

Generated SQL files are committed to the repo, so every deployment is reproducible.

---

## 3. Option A — Vercel

```bash
npm i -g vercel
vercel link
vercel env add DATABASE_URL          # + all variables from step 1
vercel env add SESSION_SECRET
vercel env add ADMIN_API_TOKEN
vercel env add TELEGRAM_BOT_TOKEN
vercel --prod
```

Notes:
* Route handlers are all `force-dynamic`, so there is no caching surprise.
* SSE works on Node runtimes; if your plan buffers responses, the Mini App automatically
  falls back to 4-second polling (`GET /api/orders/:id`).
* `npx drizzle-kit migrate` must be run from CI or your machine against the production DB.

## 3. Option B — Docker / VPS

`Dockerfile`

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "run", "start"]
```

```bash
docker build -t vibe-miniapp .
docker run -d --name vibe-miniapp --restart always \
  -p 3000:3000 --env-file .env vibe-miniapp
```

Put nginx or Caddy in front for TLS:

```nginx
server {
  server_name mini.vibe.uz;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;          # required for SSE
    proxy_read_timeout 90s;       # required for agent long polling
  }
}
```

---

## 4. Deploy the agent on the POS computer

See [POS-INTEGRATION.md §4](POS-INTEGRATION.md#4-agent-installation-on-the-pos-computer).
Summary: copy `agent/`, create the device in the admin API, fill `agent.config.json`,
run `node agent/vibe-pos-agent.mjs` under a service manager.

Verify the bridge from anywhere:

```bash
curl -s https://mini.vibe.uz/api/health | jq .pos
# { "mode": "pos", "online": true, "queuePending": 0, "hasFailedJobs": false }
```

---

## 5. Post-deployment smoke test

```bash
# 1) health
curl -s https://mini.vibe.uz/api/health

# 2) menu comes from the POS
curl -s https://mini.vibe.uz/api/menu | jq '.meta'

# 3) admin overview
curl -s https://mini.vibe.uz/api/admin/overview -H 'x-admin-token: SECRET' | jq '.queue, .env'

# 4) end-to-end order: open the Mini App on a phone, place an order and confirm
#    it shows up in the POS "Buyurtmalar" page and prints the kitchen receipt.
```

---

## 6. Monitoring & operations

| Signal | Where | Meaning |
| --- | --- | --- |
| `pos.online` | `/api/health` | agent heartbeat within the last 120s |
| `pos.queuePending` | `/api/health` | orders waiting for the POS |
| `pos.hasFailedJobs` | `/api/health` | jobs that exhausted retries — act now |
| `audit_logs` | `/api/admin/overview` | logins, order creation, bridge results, webhooks |
| `pos_jobs.last_error` | admin overview / DB | last POS error message |

Operational playbooks:

* **Order stuck in `pending`** → check the POS computer, then `POST /api/admin/jobs/:id/requeue`.
* **Order in `pos_failed`** → the POS rejected it (usually price/stock mismatch). Fix the cause,
  then requeue; the customer is already seeing a clear Uzbek error state.
* **Rotating a compromised agent** → `PATCH /api/admin/devices { "rotateSecret": true }`, update
  the agent config, restart the agent.
* **Blocking a customer** → set `customers.is_blocked` (login returns `403`).

---

## 7. Rolling back

The cloud is stateless apart from Postgres. Deploy a previous image/build, then
`npx drizzle-kit migrate` is only additive — new tables/columns are added, existing data is kept.
The POS database is never touched by a cloud rollback.
