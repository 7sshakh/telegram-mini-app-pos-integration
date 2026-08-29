# VIBE Mini App — REST API reference

Base URL: `https://<your-deployment>` · All responses are JSON · `cache-control: no-store`.

**Auth model**

| Caller | Header | Issued by |
| --- | --- | --- |
| Customer (Mini App) | `Authorization: Bearer <sessionToken>` | `POST /api/auth/telegram` |
| POS bridge agent | `Authorization: Bearer <agentToken>` | `POST /api/bridge/register` |
| POS owner / admin | `x-admin-token: <ADMIN_API_TOKEN>` | environment variable |

Sessions last 30 days (`sessions` table, only hashes are stored). Telegram `initData` is
verified with HMAC-SHA256 (`secret = SHA256(bot_token)`) and `auth_date` freshness is enforced.

Standard error body:

```json
{ "error": { "code": "OUT_OF_STOCK", "message": "Cheese hotdog dan faqat 2 ta qoldi.", "details": null } }
```

Codes: `UNAUTHORIZED`, `SESSION_EXPIRED` (HTTP 440), `FORBIDDEN`, `VALIDATION`, `PRODUCT_UNAVAILABLE`,
`OUT_OF_STOCK`, `MIN_ORDER`, `PROMO_NOT_AVAILABLE`, `PAYMENT_REQUIRED`, `PAYMENT_FAILED`, `IDEMPOTENCY`,
`POS_OFFLINE` (503), `NOT_FOUND`, `RATE_LIMITED` (429), `INTERNAL`, `NETWORK` (client side).

---

## Customer endpoints

### `POST /api/auth/telegram`
```json
{ "initData": "query_id=...&user=%7B...%7D&auth_date=1730000000&hash=abcd...", "platform": "android" }
```
`200` → `{ token, expiresAt, verified, customer: { id, telegramId, firstName, username, phone, completedOrders, loyaltyEligible, isNew } }`

`440` session expired (user must reopen the Mini App) · `401` invalid signature.
Rate limited: 40 requests / minute / IP.

### `GET /api/menu`
Public. Returns the POS catalog (cached ≤ `CATALOG_TTL_SECONDS`):
`{ brand, currency, categories[], products[], settings, promotions[], meta }`
`meta` = `{ source: "pos"|"mock", posOnline, stale, degraded, fetchedAt, catalogVersion, mockMode }`.

### `POST /api/quote` 🔒
Body: `{ "cart": [{ "productId": "hd_cheese", "qty": 2, "modifiers": [{ "id": "mod_jalapeno", "qty": 1 }] }],
"orderType": "delivery", "promoCode": null }`
Returns the authoritative `{ quote: { lines, itemsTotal, subtotal, promoDiscount, promo, deliveryFee, total, etaMinutes, explanations[] } }`.
Prices are never read from the client.

### `GET /api/profile` 🔒 · `PATCH /api/profile` 🔒
`PATCH { "phone": "+998901234567" }` — needed for phone-gated promos (4+1).

### `GET/POST /api/addresses` 🔒 · `PATCH/DELETE /api/addresses?id=…` 🔒
Address object: `label(home|work|other)`, `addressLine`, `apartment`, `entrance`, `floor`,
`landmark`, `note`, `lat`, `lng`. Max 10 addresses per customer.

### `GET /api/orders?limit=20` 🔒
Order history with items, totals, payment, address and timeline.

### `POST /api/orders` 🔒
```json
{
  "idempotencyKey": "ord-lx8k3-a91f…",        // generated in the Mini App
  "orderType": "delivery",
  "asap": true,
  "scheduledFor": null,
  "address": { "label": "home", "addressLine": "Chilonzor 9-kvartal", "apartment": "42",
               "entrance": "3", "floor": "5", "landmark": "Makab oldida", "note": "Kod 1234",
               "lat": 41.275512, "lng": 69.207431 },
  "cart": [{ "productId": "hd_cheese", "qty": 2, "modifiers": [{ "id": "mod_cheese", "qty": 1 }], "note": "sous ko‘p" }],
  "promoCode": null,
  "customerNote": "Tezroq bo‘lsa yaxshi edi",
  "payment": { "method": "cash", "cashGiven": 100000 }
}
```
`201` → `{ order, created: true, queue: { status, attempts, lastError } }`
Replaying the same `idempotencyKey` returns the same order with `created: false` (HTTP 200).
Payment methods: `cash`, `card_transfer`, `terminal`, `mixed` (`cashPart`+`cardPart`), `online`.
`cash` → server computes `change`. `online` → order stays unpaid until a webhook confirms.

### `GET /api/orders/:id` 🔒 · `DELETE /api/orders/:id` 🔒
`DELETE` cancels while the order is still `new`/`accepted` and queues a `CANCEL_ORDER` job.

### `GET /api/orders/:id/stream?token=<sessionToken>` 🔒
SSE: events `order` (full order + queue state), `ping`, `bye` (reconnect).
Poll `GET /api/orders/:id` as a fallback.

### `POST /api/payments/intent` 🔒
`{ "orderId": "uuid" }` → `{ intentId, provider, status, checkoutUrl }`. Provider credentials stay
server side.

### `POST /api/dev/login` (DEV_MODE only)
Issues a session for browser testing. Returns `404` when `DEV_MODE=false`.

---

## POS bridge endpoints (agent only)

### `POST /api/bridge/register`
`{ deviceId, deviceSecret, name, fingerprint, agentVersion, posVersion }` → `{ agentToken, pollSeconds, jobLeaseSeconds, maxAttempts }`
The agent token is rotated on every registration; only its hash is stored.

### `POST /api/bridge/jobs/claim?wait=25`
Long poll. Returns up to 5 jobs atomically (`FOR UPDATE SKIP LOCKED`):
`{ jobs: [{ id, type, orderId, payload, attempts, maxAttempts }], pending, posOnline, serverTime, leaseSeconds }`
Job types: `CREATE_ORDER`, `CANCEL_ORDER`, `REFRESH_CATALOG`, `PING`.

`CREATE_ORDER.payload` contains everything the POS needs:
`orderNumber`, `idempotencyKey`, `orderType`, `asap`, `scheduledFor`, `address`, `customerNote`,
`items[]` (productId, qty, unitPrice, modifiers, note), `totals`, `promo`, `payment`,
`etaMinutes` and `validation.expectedTotal` (POS must reject if its own total differs).

### `POST /api/bridge/jobs/:id/result`
`{ ok, posOrderId?, posOrderNumber?, status?, error?, fatal?, retryInSeconds? }`
* `ok:true` → order becomes `posSyncStatus=synced`, POS ids stored, status applied, customer notified.
* `ok:false` → job returns to the queue with exponential backoff, or dies when `fatal`/`maxAttempts`.

### `POST /api/bridge/push/catalog`
`{ catalog: PosCatalog, promotions: PromotionDef[] }` — the only way menu data enters the cloud.

### `POST /api/bridge/push/order-status`
`{ posOrderId?, orderId?, status, note? }` — statuses: `new, accepted, preparing, ready, on_the_way,
delivered, completed, cancelled`. Updates the Mini App timeline and sends the Telegram notification.

### `POST /api/bridge/heartbeat`
Keeps the device “online”, releases expired job leases, returns queue depth.

---

## Admin endpoints

`x-admin-token` required for all.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/overview` | env snapshot, queue by status, 7-day stats, last 25 orders, audit log |
| `GET /api/admin/devices` | registered devices + online state |
| `POST /api/admin/devices` | `{ name }` → `{ deviceId, deviceSecret }` (secret shown once) |
| `PATCH /api/admin/devices` | `{ id, disabled?, rotateSecret? }` |
| `POST /api/admin/jobs/:id/requeue` | re-deliver a stuck/dead job |

### `GET /api/health`
`{ ok, pos: { mode, online, queuePending, hasFailedJobs }, telegram, security }` — safe for uptime monitors.

---

## Payment webhooks

`POST /api/payments/webhook/<provider>` (provider: `payme` | `click` | `stripe`).
The raw body is verified with the provider secret (`x-<provider>-signature`, HMAC-SHA256) before
anything is trusted. Expected body: `{ "order_id": "<uuid>", "external_id": "…", "amount": 42000, "status": "succeeded"|"failed" }`.
Online payments are only marked paid here — never from the client.
