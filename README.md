# VIBE — HotDog · Burger · Drinks · Telegram Mini App

Production-ready Telegram Mini App for the customers of a local **VIBE** POS (Electron + SQLite),
with a **secure bridge architecture**. The local POS stays the single source of truth — this
project never writes to the POS database directly and never exposes it to the internet.

```
 Telegram Mini App  ──HTTPS──▶  Cloud API (Next.js + Postgres)  ◀──long poll──  POS bridge agent
      (customer)                  sessions · queue · mirror                      (POS computer)
                                                                              │ 127.0.0.1 only
                                                                              ▼
                                                          Electron POS main process  →  SQLite (source of truth)
                                                                                      │
                                                                        recipes · stock · promos · printing
```

**What the POS keeps owning:** menu/products/categories/prices/images/modifiers, stock,
promotions & discounts, orders/payments/customers/analytics, kitchen receipt printing,
order statuses.

**What the cloud owns:** Telegram auth, customer profiles + saved addresses, loyalty/promo
usage tracking, the durable order outbox queue, payment intent records, audit logs and the
read-only menu cache for fast mobile rendering.

---

## 1. Repository layout

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js App Router: Mini App pages + REST API routes |
| `src/components` | Mini App UI (menu, cart, checkout, address/map, tracking, profile) |
| `src/lib` | Domain logic: pricing, promotions, Telegram auth, orders, jobs, payments |
| `src/lib/client` | Browser side: API client, state store, Telegram SDK bridge |
| `src/db` | Drizzle schema + Postgres client |
| `src/lib/__tests__` | Vitest unit tests for order/pricing/promo/auth logic |
| `agent/vibe-pos-agent.mjs` | Local bridge agent that runs next to the Electron POS |
| `agent/mock-pos-server.mjs` | Development-only mock POS implementing the same contract |
| `docs/` | API reference, POS integration, Telegram setup, deployment |

---

## 2. Quick start (local, mock mode — no POS needed)

```bash
cp .env.example .env         # defaults are already development friendly
npm install
npx drizzle-kit push         # create tables in the local Postgres
npm run dev                  # http://localhost:3000
```

Open `http://localhost:3000` in a browser → the app detects that it is not inside Telegram and
offers **“Demo rejimda kirish”** (works only while `DEV_MODE=true`). You get the full flow:
menu → cart → address with map → payment → order → live tracking.

Mock mode uses `src/lib/mock-pos.ts` (`POS_MODE=mock`) so no POS computer is needed.

Run the tests:

```bash
npx vitest run               # 25 unit tests: pricing, promos, cash/mixed payments, Telegram auth
```

---

## 3. Quick start (local, real POS bridge)

Three terminals:

```bash
# 1) cloud
POS_MODE=pos ALLOW_MOCK_FALLBACK=false npm run dev

# 2) mock local POS adapter (stands in for the Electron POS in development)
POS_TOKEN=dev-local-pos-token node agent/mock-pos-server.mjs

# 3) bridge agent
CLOUD_URL=http://localhost:3000 \
POS_URL=http://127.0.0.1:8787 \
POS_TOKEN=dev-local-pos-token \
DEVICE_ID=… DEVICE_SECRET=… \
node agent/vibe-pos-agent.mjs
```

`DEVICE_ID` / `DEVICE_SECRET` are issued once by the admin endpoint:

```bash
curl -X POST http://localhost:3000/api/admin/devices \
  -H 'x-admin-token: YOUR_ADMIN_API_TOKEN' \
  -H 'content-type: application/json' \
  -d '{"name":"VIBE-POS-1"}'
```

The agent registers itself, pushes the POS menu to the cloud, then long-polls for orders.
Orders created in the Mini App appear in the POS within a second when the POS is online.

For the real Electron POS integration see **[docs/POS-INTEGRATION.md](docs/POS-INTEGRATION.md)**.

---

## 4. Guarantees the system is built around

| Requirement | How it is guaranteed |
| --- | --- |
| No duplicate orders | Client generates an `idempotencyKey`; unique index `(customer_id, idempotency_key)` + `pos_jobs.dedupe_key` + POS-side idempotency map |
| No lost orders | Orders are committed to Postgres together with an outbox job (`pos_jobs`) in one transaction; the job survives POS downtime with exponential backoff (`attempts < max_attempts`) |
| Correct pricing | Prices/modifiers are recomputed server-side from the POS catalog snapshot; client-sent prices are ignored; the POS re-prices again and rejects mismatches (HTTP 422) |
| Correct promotions | Promo evaluation runs on the cloud for display and again in the POS before acceptance; usage counters live in `promo_usage`; no free item can be injected from the client |
| Correct stock | Stock is deducted by the existing POS recipe logic; the Mini App only *reads* the `stock` field for validation and display |
| No secrets in the client | Bot token, admin token, provider keys, POS token and SQLite paths never reach the browser; only opaque session/agent tokens are used |
| No public access to the POS | The POS adapter listens on `127.0.0.1` only and requires `x-pos-token`; the cloud never connects to the POS — the agent polls out |

---

## 5. Environment variables

See the fully commented [`.env.example`](.env.example). The essential ones:

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres for the cloud service |
| `APP_BASE_URL` | yes (prod) | Public URL, used for payment webhooks |
| `SESSION_SECRET` | yes | 32+ random bytes, signs customer sessions |
| `ADMIN_API_TOKEN` | yes | Long random string, protects `/api/admin/*` |
| `TELEGRAM_BOT_TOKEN` | yes (prod) | From @BotFather; needed for initData verification + notifications |
| `POS_MODE` | yes | `mock` (development) or `pos` (production) |
| `DEV_MODE` / `ALLOW_UNVERIFIED_INITDATA` / `ALLOW_MOCK_FALLBACK` | no | Must all be `false` in production |
| `PAYMENT_PROVIDER` | no | `manual` (default), `payme`, `click`, `stripe` |
| `BRIDGE_*`, `CATALOG_TTL_SECONDS` | no | Queue/agent tuning |
| Agent: `CLOUD_URL`, `POS_URL`, `POS_TOKEN`, `DEVICE_ID`, `DEVICE_SECRET` | yes | Set on the POS computer, not in the cloud |

---

## 6. Database

```bash
npx drizzle-kit push        # apply the schema (dev / staging)
npx drizzle-kit generate    # emit SQL migration files into ./drizzle
npx drizzle-kit migrate     # apply generated migrations (production)
```

Tables: `customers`, `sessions`, `addresses`, `catalog_snapshots`, `pos_devices`, `pos_jobs`,
`orders`, `order_events`, `promo_usage`, `payment_intents`, `audit_logs`, `app_settings`.

---

## 7. Operations

* `GET /api/health` — liveness + POS/queue/security snapshot (no secrets).
* `GET /api/admin/overview` (`x-admin-token`) — queue depth, dead jobs, devices, orders, audit log.
* `POST /api/admin/devices` — issue device credentials (secret shown once).
* `POST /api/admin/jobs/:id/requeue` — re-deliver a stuck order to the POS.

Deployment instructions: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**
Telegram/BotFather setup: **[docs/TELEGRAM-SETUP.md](docs/TELEGRAM-SETUP.md)**
Full REST API reference: **[docs/API.md](docs/API.md)**

---

## 8. Design & UX notes

* Mobile-first dark premium theme, brand gradient (mustard → flame), glass cards.
* Skeletons for every async surface, optimistic cart math (server still authoritative),
  human-readable Uzbek (Latin) errors, empty states, offline banners.
* Telegram haptics on add-to-cart, quantity changes, promo application, order success/errors.
* Live order tracking via SSE (`/api/orders/:id/stream`) with automatic polling fallback.
* Zero heavy frontend dependencies: no map library (custom OSM tile map), no state library,
  no UI kit. The whole client bundle stays small, which matters inside Telegram on Android.
