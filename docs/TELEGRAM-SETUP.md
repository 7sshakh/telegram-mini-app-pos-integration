# Telegram BotFather setup

## 1. Create the bot

1. Open [@BotFather](https://t.me/BotFather) → `/newbot`.
2. Name: `VIBE — HotDog · Burger · Drinks`
3. Username: `vibe_orders_bot` (must end in `bot`).
4. Copy the token → `TELEGRAM_BOT_TOKEN`. It is the **only** way to verify Mini App users, keep
   it server side only.

## 2. Create the Mini App

```
/newapp
```

* Short name: `VIBE`
* Description: `HotDog, burger va ichimliklarni tez buyurtma qiling`
* Upload a 512×512 icon and a 640×360 photo.
* Set the Web App URL: `https://<your-domain>` (the Next.js deployment root).

Useful commands:

```
/mybots → VIBE → Bot Settings → Menu Button     → set to your URL + "Buyurtma berish"
/mybots → VIBE → Bot Settings → Edit Commands   → /start — Buyurtma berish
/setmenubutton                                   → attach the Mini App to the bot menu
```

## 3. Environment variables

| Variable | Value |
| --- | --- |
| `TELEGRAM_BOT_TOKEN` | the BotFather token |
| `TELEGRAM_BOT_USERNAME` | `vibe_orders_bot` |
| `APP_BASE_URL` | `https://<your-domain>` |
| `TELEGRAM_AUTH_TTL` | `86400` (seconds a login stays fresh) |
| `TELEGRAM_NOTIFY` | `true` → order status push notifications |

## 4. How login works (no password)

1. The Mini App reads `window.Telegram.WebApp.initData`.
2. `POST /api/auth/telegram` sends it to the cloud.
3. The cloud recomputes `HMAC_SHA256(data_check_string, SHA256(bot_token))` and compares it with
   the `hash` field using a timing-safe comparison. Any change to `user.id` invalidates it.
4. `auth_date` must be within `TELEGRAM_AUTH_TTL`; otherwise the app asks the user to reopen it.
5. A 30-day opaque session token is issued; only its HMAC hash is stored in Postgres.

If `TELEGRAM_BOT_TOKEN` is missing in production, logins fail closed (`401`) — they are never
silently accepted. `ALLOW_UNVERIFIED_INITDATA=true` is a development-only escape hatch.

## 5. Optional: contact & location

* The address screen uses `navigator.geolocation` (works inside Telegram on Android/iOS).
  If the user denies it, the manual address form still works.
* “Telegram orqali raqamni ulashish” calls `WebApp.requestContact()` — the returned phone number
  is stored on the customer profile and unlocks the 4+1 loyalty promo.

## 6. Bot notifications

Sent automatically by the cloud (`sendMessage`, HTML) when:
an order is created, the POS accepts/prepares/ready/on-the-way/delivered/completed/cancelled it,
and when an online payment succeeds or fails.

To also receive **admin** notifications in a staff group, add the bot to the group and extend
`src/lib/orders.ts` (`sendTelegramMessage`) with the group chat id stored in `app_settings`.

## 7. Checklist before going live

- [ ] `DEV_MODE=false`, `ALLOW_UNVERIFIED_INITDATA=false`, `ALLOW_MOCK_FALLBACK=false`
- [ ] `POS_MODE=pos`
- [ ] `SESSION_SECRET` and `ADMIN_API_TOKEN` are long random strings
- [ ] HTTPS is served (Telegram requires it outside of localhost)
- [ ] The Mini App opens on a real phone and login succeeds
- [ ] A test order reaches the POS *Buyurtmalar* page and prints a kitchen receipt
- [ ] Changing the status in the POS updates the Mini App timeline and sends a Telegram message
