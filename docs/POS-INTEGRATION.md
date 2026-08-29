# Integrating the Mini App with the existing VIBE Electron + SQLite POS

> Goal: the POS stays untouched as the system of record. We only add a **localhost-only HTTP
> adapter** inside the Electron main process and run the **bridge agent** next to it.
> No new database, no schema changes, no duplicated business logic.

```
Telegram Mini App ──▶ cloud API (Postgres queue) ──long poll──▶ bridge agent ──▶ Electron main
                                                                                    │ 127.0.0.1
                                                                                    ▼
                                                              existing POS services ─▶ SQLite
                                                              (recipes, stock, promos, printing)
```

---

## 1. What you add to the Electron POS (≈80 lines)

Create a `vibe-bridge.js` module in the Electron **main** process and call `startVibeBridge()`
during app start-up. It exposes the 6 endpoints the agent needs.

```js
// vibe-bridge.js — Electron main process
const http = require("node:http");
const crypto = require("node:crypto");

const POS_TOKEN = process.env.VIBE_POS_TOKEN;       // shared secret with the agent
const PORT = Number(process.env.VIBE_POS_PORT || 8787);

function startVibeBridge(pos) {                     // `pos` = your existing service layer
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.headers["x-pos-token"] !== POS_TOKEN) return json(res, 401, { ok: false });

    // ---- health ---------------------------------------------------------
    if (req.method === "GET" && url.pathname === "/internal/health")
      return json(res, 200, { ok: true, version: pos.version() });

    // ---- menu / stock / promos (read only) ------------------------------
    if (req.method === "GET" && url.pathname === "/internal/menu")
      return json(res, 200, {
        catalog: pos.buildCatalogForTelegram(),     // implement once, see §2
        promotions: pos.getActivePromotions(),
      });

    // ---- create order (existing logic: pricing, recipes, stock, print) --
    if (req.method === "POST" && url.pathname === "/internal/orders") {
      const payload = await body(req);
      // Idempotency: reuse your existing idempotency table or an in-memory Map
      const seen = await pos.findOrderByKey(payload.idempotencyKey);
      if (seen) return json(res, 200, { ok: true, duplicate: true, ...seen });

      // Re-price with YOUR prices/promos. Never trust the incoming totals.
      const priced = pos.repriceForTelegram(payload.items, payload.orderType, payload.promo?.code);
      if (priced.error) return json(res, 422, { ok: false, message: priced.error });
      if (payload.validation?.expectedTotal !== priced.total)
        return json(res, 422, { ok: false, message: `Narx mos kelmadi: ${priced.total}` });

      const order = await pos.createTelegramOrder({          // existing service
        payload, priced,
        customer: payload.customer,
        onCreated: (created) => pos.printKitchenReceipt(created), // existing printer
      });
      return json(res, 200, { ok: true, orderId: order.id, orderNumber: order.number, status: order.status });
    }

    // ---- status changes coming from the POS UI --------------------------
    if (req.method === "GET" && url.pathname === "/internal/orders/changed") {
      return json(res, 200, { orders: await pos.ordersChangedSince(url.searchParams.get("since")) });
    }

    const status = url.pathname.match(/^\/internal\/orders\/([^/]+)\/status$/);
    if (req.method === "POST" && status) {
      const order = await pos.setStatus(status[1], (await body(req)).status);
      return json(res, 200, { ok: true, order });
    }

    const cancel = url.pathname.match(/^\/internal\/orders\/([^/]+)\/cancel$/);
    if (req.method === "POST" && cancel) {
      return json(res, 200, { ok: true, order: await pos.cancelOrder(cancel[1]) });
    }

    return json(res, 404, { ok: false });
  });

  // 127.0.0.1 only — never 0.0.0.0
  server.listen(PORT, "127.0.0.1", () => console.log(`[vibe-bridge] http://127.0.0.1:${PORT}`));
  return server;
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}
function body(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")));
  });
}

module.exports = { startVibeBridge };
```

### Security rules (non negotiable)

1. Bind to `127.0.0.1` only.
2. Require `x-pos-token` on every request; generate it with
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
3. Do **not** forward this server through ngrok/iptables/anything. The agent is the only client.
4. Never return DB paths, admin credentials or raw SQLite contents.
5. Never accept prices from the payload — always re-price and reject mismatches with HTTP 422.

---

## 2. `buildCatalogForTelegram()` — the single mapping function

Return exactly this shape (all money as integer so‘m):

```ts
type Catalog = {
  version: string;              // e.g. "2026-02-14T10:00" — bump when data changes
  source: "pos";
  currency: "UZS";
  generatedAt: string;          // ISO timestamp
  categories: { id: string; name: string; emoji?: string; sortOrder: number }[];
  products: {
    id: string;                 // your SQLite product id (it round-trips in orders)
    categoryId: string;
    name: string;
    description?: string;
    price: number;
    oldPrice?: number;
    imageUrl?: string;          // absolute URL or base64 data URL your POS already stores
    isAvailable: boolean;       // active + not stopped in POS
    stock: number | null;       // null if the POS does not track stock for it
    modifiers: { id: string; name: string; price: number; groupName?: string; maxQty?: number }[];
    tags?: string[];            // "popular" | "new" | "spicy" | "combo"
  }[];
  settings: {
    brandName: string; currency: "UZS";
    deliveryEnabled: boolean; pickupEnabled: boolean; dineInEnabled: boolean;
    deliveryFee: number; freeDeliveryFrom: number; minOrderAmount: number;
    prepMinutes: number; deliveryMinutes: number;
    paymentMethods: { id: "cash"|"card_transfer"|"terminal"|"mixed"|"online";
                      label: string; hint?: string; enabled: boolean; requiresOnline: boolean }[];
    workHours: { open: string; close: string } | null;
    address: string; phone: string; location: { lat: number; lng: number };
  };
};
```

Promotions map to:

```ts
type Promotion = {
  code: string;                              // "4PLUS1", "OPENING_2PLUS1"
  title: string;                             // Uzbek, shown to the customer
  description?: string;
  type: "FOUR_PLUS_ONE" | "TWO_PLUS_ONE" | "PERCENT" | "FIXED";
  eligibleCategoryIds: string[];             // [] = whole menu
  eligibleProductIds: string[];
  minQty: number;                            // paid units required (4 for 4+1, 2 for 2+1)
  discountPercent?: number; discountAmount?: number;
  requiresPhone: boolean;                    // 4+1 needs a verified phone number
  requiresHistory: boolean;                  // 4+1 needs ≥1 completed order
  maxUsesPerCustomer: number | null;
  activeFrom: string | null; activeUntil: string | null;
  enabled: boolean; priority: number;
};
```

* **4+1** = the cart must contain **5** eligible units, the cheapest becomes free.
* **2+1 opening** = **3** eligible units, the cheapest becomes free, bounded by `activeUntil`.
* The same rule must run in the POS when the order arrives (the cloud only previews it).

---

## 3. Order creation inside the POS

`POST /internal/orders` payload:

```json
{
  "version": 1, "source": "telegram_mini_app",
  "orderId": "cloud-uuid", "orderNumber": "V-260214-003", "idempotencyKey": "ord-…:uuid",
  "createdAt": "…", "orderType": "delivery", "asap": true, "scheduledFor": null,
  "address": { "addressLine": "…", "apartment": "42", "entrance": "3", "floor": "5",
               "landmark": "…", "note": "…", "lat": 41.2755, "lng": 69.2074 },
  "customerNote": "…",
  "items": [{ "productId": "hd_cheese", "name": "Cheese hotdog", "qty": 2, "unitPrice": 30000,
              "modifiers": [{ "id": "mod_cheese", "name": "Pishloq", "price": 3000, "qty": 1 }],
              "note": null, "lineTotal": 60000 }],
  "totals": { "itemsTotal": 60000, "subtotal": 30000, "promoDiscount": 30000,
              "deliveryFee": 12000, "total": 42000, "currency": "UZS" },
  "promo": { "code": "4PLUS1", "title": "4+1 doimiy mijozlarga", "discount": 30000, "freeItems": [] },
  "payment": { "method": "cash", "label": "Naqd pul", "cashGiven": 100000, "change": 58000,
               "onlineStatus": "none" },
  "validation": { "expectedItemsTotal": 60000, "expectedTotal": 42000, "currency": "UZS" }
}
```

Inside `createTelegramOrder` you should:

1. **Idempotency** — look up `idempotencyKey` first and return the existing order if present.
2. **Re-price** with your own products/modifiers/promos; reject on mismatch (`422`, `fatal`).
3. **Stock** — deduct through your existing recipe logic (this is why stock is never touched by the cloud).
4. **Persist** the order with the source `telegram`, the cloud `orderId` (so status pushes can be
   matched) and the customer record (match by phone or Telegram id).
5. **Print** the kitchen/receipt copies exactly like a normal POS order.
6. **Return** `{ ok: true, orderId, orderNumber, status }` — this is what makes the order appear
   in the existing *Buyurtmalar* page instantly.

> Status changes made by staff in the POS UI must be visible to `/internal/orders/changed`
> (either a `changedAt` column or an in-memory ring buffer of the last 200 events is enough).

---

## 4. Agent installation on the POS computer

1. Copy the `agent/` folder (or `git clone` the repo) onto the POS computer.
2. Node.js 18+ required (no npm install needed — the agent has zero dependencies).
3. Create the device in the cloud admin API and copy the credentials:

```bash
curl -X POST https://mini.vibe.uz/api/admin/devices \
  -H 'x-admin-token: SECRET' -H 'content-type: application/json' -d '{"name":"VIBE-POS-1"}'
```

4. Save `agent/agent.config.json`:

```json
{
  "CLOUD_URL": "https://mini.vibe.uz",
  "POS_URL": "http://127.0.0.1:8787",
  "POS_TOKEN": "<same as VIBE_POS_TOKEN in the Electron app>",
  "DEVICE_ID": "vibe-pos-ab12cd34",
  "DEVICE_SECRET": "<from the admin response>",
  "AGENT_NAME": "VIBE-POS-1"
}
```

5. Run it (and keep it running — Task Scheduler / systemd / launchd):

```bash
node agent/vibe-pos-agent.mjs
```

Windows Task Scheduler example (auto-start, restart on crash):

```
Program:   node.exe
Arguments: C:\vibe-agent\vibe-pos-agent.mjs
Start in:  C:\vibe-agent
Trigger:   At startup · Restart every 1 minute on failure
```

Linux systemd unit:

```ini
[Unit]
Description=VIBE POS bridge agent
After=network-online.target

[Service]
WorkingDirectory=/opt/vibe-agent
ExecStart=/usr/bin/node /opt/vibe-agent/vibe-pos-agent.mjs
Restart=always
RestartSec=5
Environment=CLOUD_URL=https://mini.vibe.uz

[Install]
WantedBy=multi-user.target
```

---

## 5. Behaviour when the POS computer is offline

* Orders keep being accepted in the Mini App and stay in `pos_jobs` (`status=pending`).
* The customer sees **“POS kompyuteri hozir offline. Buyurtma navbatda”** plus the timeline.
* The customer UI shows `posSyncStatus: pending` until the agent claims the job.
* When the computer comes back, the agent long-polls, claims the pending jobs in order and
  delivers them; retries use exponential backoff (5s → 300s) up to `BRIDGE_MAX_ATTEMPTS`.
* A job that the POS refuses (`422`) is marked `dead` and the order becomes `pos_failed`, so
  staff can see it in `/api/admin/overview` and requeue it manually.
* A claimed-but-unacknowledged job is automatically returned to the queue after
  `BRIDGE_JOB_LEASE_SECONDS` (agent crash safety).

---

## 6. Testing the integration without the real POS

`agent/mock-pos-server.mjs` implements the whole contract, including re-pricing, stock
deduction via recipes, kitchen receipt printing and status transitions:

```bash
POS_TOKEN=dev-local-pos-token node agent/mock-pos-server.mjs
```

Then point the agent at it (`POS_URL=http://127.0.0.1:8787`, same token) and run the cloud with
`POS_MODE=pos ALLOW_MOCK_FALLBACK=false`. This is exactly what CI / staging uses.
