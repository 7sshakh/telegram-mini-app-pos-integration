"use client";

import { useEffect, useMemo, useState } from "react";

import { AddressSheet, type AddressDraft } from "@/components/AddressSheet";
import { MiniMap } from "@/components/MiniMap";
import { Button, EmptyState, Icon, Money, QtyStepper, SectionTitle, Sheet } from "@/components/ui";
import { api, ApiError } from "@/lib/client/api";
import { haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { ORDER_TYPE_LABELS, PAYMENT_LABELS, etaText } from "@/lib/uz";
import { formatSum } from "@/lib/format";
import type { OrderAddress, PaymentMethod, PosProduct, Quote } from "@/lib/types";

type Step = "cart" | "checkout" | "confirm";

export function CartView() {
  const { state, estimate, estimateError, setQty, removeItem, clearCart, setCheckout, submitOrder, toast, setTab } = useApp();
  const [step, setStep] = useState<Step>("cart");
  const [addressSheet, setAddressSheet] = useState(false);
  const [serverQuote, setServerQuote] = useState<Quote | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [promoInput, setPromoInput] = useState("");

  const settings = state.catalog?.settings;
  const quote = serverQuote ?? estimate;
  const address = state.checkout.address;
  const method = state.checkout.paymentMethod;

  const productById = useMemo(() => {
    const map = new Map<string, PosProduct>();
    for (const product of state.catalog?.products ?? []) map.set(product.id, product);
    return map;
  }, [state.catalog?.products]);

  const cartTotal = state.cart.reduce((sum, item) => {
    const product = productById.get(item.productId);
    if (!product) return sum;
    const mods = item.modifiers.reduce((modSum, mod) => {
      const modifier = product.modifiers.find((entry) => entry.id === mod.id);
      return modSum + (modifier ? modifier.price * mod.qty : 0);
    }, 0);
    return sum + (product.price + mods) * item.qty;
  }, 0);

  useEffect(() => {
    setServerQuote(null);
  }, [state.cart, state.checkout.orderType, state.checkout.promoCode]);

  if (state.cart.length === 0) {
    return (
      <EmptyState
        emoji="🛒"
        title="Savatcha bo‘sh"
        text="Menyudan taom tanlang — hotdog, burger yoki ichimlik."
        action={
          <Button variant="ghost" onClick={() => setTab("menu")} className="px-5">
            Menyuga o‘tish
          </Button>
        }
      />
    );
  }

  const verifyQuote = async () => {
    setVerifying(true);
    try {
      const response = await api<{ quote: Quote }>("/api/quote", {
        method: "POST",
        body: {
          cart: state.cart.map((item) => ({
            productId: item.productId,
            qty: item.qty,
            modifiers: item.modifiers,
            note: item.note,
          })),
          orderType: state.checkout.orderType,
          promoCode: state.checkout.promoCode,
        },
      });
      setServerQuote(response.quote);
      setVerifying(false);
      return response.quote;
    } catch (error) {
      setVerifying(false);
      toast(error instanceof ApiError ? error.message : "Narxni tekshirishda xatolik.", "error");
      return null;
    }
  };

  const gotoConfirm = async () => {
    if (state.checkout.orderType === "delivery" && (!address || address.addressLine.length < 4)) {
      toast("Yetkazib berish uchun manzilni tanlang.", "error");
      return;
    }
    const verified = await verifyQuote();
    if (!verified) return;
    if (verified.total !== (estimate?.total ?? verified.total)) {
      haptic("light");
    }
    setStep("confirm");
  };

  // ------------------------------- cart -------------------------------------
  if (step === "cart") {
    return (
      <div className="px-4">
        <SectionTitle
          right={
            <button onClick={clearCart} className="tap text-[11.5px] font-semibold text-flame">
              Tozalash
            </button>
          }
        >
          Savatcha · {state.cart.length} pozitsiya
        </SectionTitle>

        <div className="space-y-2.5">
          {state.cart.map((item) => {
            const product = productById.get(item.productId);
            if (!product) return null;
            const modNames = item.modifiers
              .map((mod) => {
                const modifier = product.modifiers.find((entry) => entry.id === mod.id);
                return modifier ? `${modifier.name}${mod.qty > 1 ? ` x${mod.qty}` : ""}` : null;
              })
              .filter(Boolean)
              .join(", ");
            const unit =
              product.price +
              item.modifiers.reduce((sum, mod) => {
                const modifier = product.modifiers.find((entry) => entry.id === mod.id);
                return sum + (modifier ? modifier.price * mod.qty : 0);
              }, 0);

            return (
              <div key={item.key} className="card rise p-3">
                <div className="flex gap-3">
                  <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-ink-card">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-2xl">🍔</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold">{product.name}</p>
                    {modNames ? <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{modNames}</p> : null}
                    {item.note ? <p className="mt-0.5 text-[11px] italic text-brand/80">“{item.note}”</p> : null}
                    <div className="mt-2 flex items-center justify-between">
                      <Money value={unit * item.qty} className="text-[14px] font-extrabold text-brand" />
                      <div className="flex items-center gap-2">
                        <QtyStepper size="sm" value={item.qty} onChange={(next) => setQty(item.key, next)} />
                        <button onClick={() => removeItem(item.key)} className="tap p-1.5 text-white/40" aria-label="O‘chirish">
                          <Icon name="trash" className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card mt-4 p-4">
          <Row label="Mahsulotlar" value={formatSum(cartTotal)} />
          {estimate?.promoDiscount ? <Row label={`Aksiya (${estimate.promo?.title ?? ""})`} value={`−${formatSum(estimate.promoDiscount)}`} tone="mint" /> : null}
          {estimate?.deliveryFee ? <Row label="Yetkazib berish" value={formatSum(estimate.deliveryFee)} /> : null}
          <div className="mt-2 border-t border-white/8 pt-2">
            <Row label="Jami" value={formatSum(estimate?.total ?? cartTotal)} bold />
          </div>
          {estimateError ? <p className="mt-2 text-[11.5px] text-flame">{estimateError}</p> : null}
        </div>

        <Button className="mt-4 w-full" onClick={() => setStep("checkout")}>
          Buyurtmani rasmiylashtirish
        </Button>

        <AddressSheet open={addressSheet} onClose={() => setAddressSheet(false)} initial={null} />
      </div>
    );
  }

  // ----------------------------- checkout -----------------------------------
  if (step === "checkout") {
    const types: { id: "delivery" | "pickup" | "dine_in"; enabled: boolean; eta: number }[] = [
      { id: "delivery", enabled: !!settings?.deliveryEnabled, eta: (settings?.prepMinutes ?? 15) + (settings?.deliveryMinutes ?? 25) },
      { id: "pickup", enabled: !!settings?.pickupEnabled, eta: settings?.prepMinutes ?? 15 },
      { id: "dine_in", enabled: !!settings?.dineInEnabled, eta: settings?.prepMinutes ?? 15 },
    ];

    return (
      <div className="px-4">
        <BackBar onBack={() => setStep("cart")} title="Buyurtma tafsilotlari" />

        <SectionTitle>Buyurtma turi</SectionTitle>
        <div className="mb-5 grid grid-cols-3 gap-2">
          {types.map((type) => (
            <button
              key={type.id}
              disabled={!type.enabled}
              onClick={() => {
                haptic("light");
                setCheckout({ orderType: type.id });
              }}
              className={`tap chip px-2 py-3 text-center text-[12px] font-semibold ${
                state.checkout.orderType === type.id ? "chip-active" : "text-white/70"
              } ${type.enabled ? "" : "opacity-35"}`}
            >
              <span className="block text-[16px]">{type.id === "delivery" ? "🛵" : type.id === "pickup" ? "🏃" : "🍽"}</span>
              {ORDER_TYPE_LABELS[type.id]}
              <span className="mt-0.5 block text-[10px] font-normal opacity-70">~{type.eta} daq</span>
            </button>
          ))}
        </div>

        <SectionTitle>Vaqt</SectionTitle>
        <div className="mb-5 grid grid-cols-2 gap-2">
          <button
            onClick={() => setCheckout({ asap: true, scheduledFor: null })}
            className={`tap chip px-3 py-3 text-[12.5px] font-semibold ${state.checkout.asap ? "chip-active" : "text-white/70"}`}
          >
            ⚡ Iloji bo‘lganda
          </button>
          <button
            onClick={() => {
              const now = new Date(Date.now() + 45 * 60 * 1000);
              setCheckout({ asap: false, scheduledFor: state.checkout.scheduledFor ?? now.toISOString().slice(11, 16) });
            }}
            className={`tap chip px-3 py-3 text-[12.5px] font-semibold ${!state.checkout.asap ? "chip-active" : "text-white/70"}`}
          >
            🕒 Rejalashtirish
          </button>
        </div>
        {!state.checkout.asap ? (
          <div className="mb-5">
            <input
              type="time"
              value={state.checkout.scheduledFor ?? ""}
              onChange={(event) => setCheckout({ scheduledFor: event.target.value })}
            />
            <p className="mt-1.5 text-[11px] text-muted">Buyurtma kamida 15 daqiqadan keyingi vaqtga rejalashtiriladi.</p>
          </div>
        ) : (
          <div className="mb-5 rounded-2xl border border-white/8 bg-white/4 p-3 text-[12px] text-white/75">
            Taxminiy vaqt: <b className="text-brand">{etaText(quote?.etaMinutes ?? 0)}</b>
          </div>
        )}

        {state.checkout.orderType === "delivery" ? (
          <>
            <SectionTitle
              right={
                <button onClick={() => setAddressSheet(true)} className="tap text-[11.5px] font-semibold text-brand">
                  + Yangi manzil
                </button>
              }
            >
              Manzil
            </SectionTitle>
            <div className="mb-5 space-y-2">
              {state.addresses.length === 0 ? (
                <div className="card p-4 text-center text-[12.5px] text-muted">
                  Saqlangan manzil yo‘q.{" "}
                  <button onClick={() => setAddressSheet(true)} className="font-semibold text-brand">
                    Manzil qo‘shish
                  </button>
                </div>
              ) : (
                state.addresses.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      haptic("light");
                      setCheckout({
                        addressId: item.id,
                        address: {
                          label: item.label,
                          addressLine: item.addressLine,
                          apartment: item.apartment ?? undefined,
                          entrance: item.entrance ?? undefined,
                          floor: item.floor ?? undefined,
                          landmark: item.landmark ?? undefined,
                          note: item.note ?? undefined,
                          lat: item.lat,
                          lng: item.lng,
                        },
                      });
                    }}
                    className={`tap card flex w-full items-center gap-3 p-3 text-left ${
                      state.checkout.addressId === item.id ? "border-brand/50 bg-brand/8" : ""
                    }`}
                  >
                    <span className="text-[18px]">{item.label === "home" ? "🏠" : item.label === "work" ? "🏢" : "📍"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{item.addressLine}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {[item.apartment, item.entrance ? `podyezd ${item.entrance}` : null, item.floor ? `${item.floor}-qavat` : null]
                          .filter(Boolean)
                          .join(" · ") || "Kvartira ko‘rsatilmagan"}
                      </span>
                    </span>
                    {state.checkout.addressId === item.id ? <Icon name="check" className="h-4 w-4 text-brand" /> : null}
                  </button>
                ))
              )}
            </div>
          </>
        ) : null}

        <SectionTitle>Aksiyalar</SectionTitle>
        <div className="mb-5 space-y-2">
          {(quote?.explanations ?? []).length === 0 ? (
            <p className="text-[12px] text-muted">Hozir aktiv aksiyalar yo‘q.</p>
          ) : (
            (quote?.explanations ?? []).map((promo) => (
              <div
                key={promo.code}
                className={`card p-3 ${promo.applied ? "border-mint/40 bg-mint/8" : "border-white/8"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-bold">
                      {promo.applied ? "🎁" : "ℹ️"} {promo.title}
                    </p>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{promo.reason}</p>
                    {promo.progress ? (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-brand"
                          style={{ width: `${Math.min(100, (promo.progress.have / promo.progress.need) * 100)}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  {promo.discount > 0 ? (
                    <span className={`text-[12px] font-bold ${promo.applied ? "text-mint" : "text-white/40"}`}>
                      −{formatSum(promo.discount)}
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
          <div className="flex gap-2">
            <input
              value={promoInput}
              onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
              placeholder="Aksiya kodi (masalan VIBE10)"
              maxLength={20}
            />
            <Button
              variant="ghost"
              className="shrink-0 px-4"
              onClick={() => {
                setCheckout({ promoCode: promoInput.trim() || null });
                void verifyQuote();
              }}
            >
              Qo‘llash
            </Button>
          </div>
        </div>

        <SectionTitle>To‘lov turi</SectionTitle>
        <div className="mb-5 space-y-2">
          {(settings?.paymentMethods ?? []).map((item) => (
            <div key={item.id}>
              <button
                onClick={() => {
                  haptic("light");
                  setCheckout({ paymentMethod: item.id as PaymentMethod });
                }}
                disabled={!item.enabled}
                className={`tap card flex w-full items-center gap-3 p-3 text-left ${
                  method === item.id ? "border-brand/50 bg-brand/8" : ""
                } ${item.enabled ? "" : "opacity-40"}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">{item.label}</span>
                  {item.hint ? <span className="block text-[11px] text-muted">{item.hint}</span> : null}
                </span>
                <span
                  className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                    method === item.id ? "border-brand bg-brand" : "border-white/25"
                  }`}
                />
              </button>

              {method === item.id && item.id === "cash" ? (
                <div className="card mt-2 p-3">
                  <label className="mb-1.5 block text-[11.5px] font-semibold text-white/70">
                    Mijoz beradi (qaytim hisoblanadi)
                  </label>
                  <input
                    inputMode="numeric"
                    value={state.checkout.cashGiven ? String(state.checkout.cashGiven) : ""}
                    onChange={(event) => setCheckout({ cashGiven: Number.parseInt(event.target.value.replace(/\D/g, "") || "0", 10) })}
                    placeholder="Masalan: 100000"
                  />
                  {state.checkout.cashGiven > 0 ? (
                    <p className="mt-2 text-[12px]">
                      Qaytim: <b className="text-brand">{formatSum(Math.max(0, state.checkout.cashGiven - (quote?.total ?? 0)))} so‘m</b>
                      {state.checkout.cashGiven < (quote?.total ?? 0) ? (
                        <span className="text-flame"> · Yetarli emas</span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {method === item.id && item.id === "mixed" ? (
                <div className="card mt-2 grid grid-cols-2 gap-2 p-3">
                  <div>
                    <label className="mb-1.5 block text-[11.5px] font-semibold text-white/70">Naqd</label>
                    <input
                      inputMode="numeric"
                      value={state.checkout.cashPart ? String(state.checkout.cashPart) : ""}
                      onChange={(event) =>
                        setCheckout({ cashPart: Number.parseInt(event.target.value.replace(/\D/g, "") || "0", 10) })
                      }
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-[11.5px] font-semibold text-white/70">Karta / terminal</label>
                    <input
                      inputMode="numeric"
                      value={state.checkout.cardPart ? String(state.checkout.cardPart) : ""}
                      onChange={(event) =>
                        setCheckout({ cardPart: Number.parseInt(event.target.value.replace(/\D/g, "") || "0", 10) })
                      }
                      placeholder="0"
                    />
                  </div>
                  <p className="col-span-2 text-[11.5px] text-muted">
                    Yig‘indi jami summagа teng bo‘lishi kerak: {formatSum(quote?.total ?? 0)} so‘m
                  </p>
                </div>
              ) : null}

              {method === item.id && item.id === "online" ? (
                <p className="mt-2 text-[11.5px] text-muted">
                  Online to‘lov provider sozlangandan keyin ochiladi. To‘lov faqat webhook tasdig‘idan keyin “to‘langan”
                  bo‘ladi.
                </p>
              ) : null}
            </div>
          ))}
        </div>

        <SectionTitle>Izoh</SectionTitle>
        <textarea
          value={state.checkout.note}
          onChange={(event) => setCheckout({ note: event.target.value })}
          rows={2}
          maxLength={500}
          placeholder="Operator uchun izoh (ixtiyoriy)"
        />

        <div className="card mt-5 p-4">
          <Row label="Mahsulotlar" value={formatSum(quote?.itemsTotal ?? cartTotal)} />
          {quote?.promoDiscount ? <Row label="Aksiya chegirmasi" value={`−${formatSum(quote.promoDiscount)}`} tone="mint" /> : null}
          <Row label="Yetkazib berish" value={quote?.deliveryFee ? formatSum(quote.deliveryFee) : "—"} />
          <div className="mt-2 border-t border-white/8 pt-2">
            <Row label="Jami" value={formatSum(quote?.total ?? cartTotal)} bold />
          </div>
        </div>

        <Button className="mt-4 w-full" loading={verifying} onClick={() => void gotoConfirm()}>
          Tasdiqlash sahifasiga o‘tish
        </Button>

        <AddressSheet open={addressSheet} onClose={() => setAddressSheet(false)} initial={null} />
      </div>
    );
  }

  // ------------------------------ confirm -----------------------------------
  const canSubmit =
    !state.submitting &&
    (state.checkout.orderType !== "delivery" || (!!address && address.addressLine.length >= 4)) &&
    (method !== "cash" || state.checkout.cashGiven === 0 || state.checkout.cashGiven >= (quote?.total ?? 0)) &&
    (method !== "mixed" || state.checkout.cashPart + state.checkout.cardPart === (quote?.total ?? 0));

  return (
    <div className="px-4">
      <BackBar onBack={() => setStep("checkout")} title="Buyurtmani tasdiqlang" />

      <div className="card mb-4 p-4">
        <p className="mb-3 text-[13px] font-bold">🧾 Buyurtma tarkibi</p>
        <div className="space-y-2">
          {(quote?.lines ?? []).map((line) => (
            <div key={`${line.productId}-${line.modifiers.map((m) => m.id).join()}`} className="flex justify-between gap-3 text-[12.5px]">
              <span className="min-w-0">
                <b>{line.qty}×</b> {line.name}
                {line.modifiers.length ? (
                  <span className="block text-[11px] text-muted">{line.modifiers.map((m) => m.name).join(", ")}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-semibold">{formatSum(line.lineTotal)}</span>
            </div>
          ))}
        </div>
      </div>

      {state.checkout.orderType === "delivery" && address ? (
        <div className="card mb-4 overflow-hidden">
          <div className="p-4 pb-3">
            <p className="mb-2 text-[13px] font-bold">📍 Yetkazib berish manzili</p>
            <p className="text-[13px] font-semibold">{address.addressLine}</p>
            <p className="mt-1 text-[11.5px] text-muted">
              {[
                address.apartment ? `Kv. ${address.apartment}` : null,
                address.entrance ? `Podyezd ${address.entrance}` : null,
                address.floor ? `${address.floor}-qavat` : null,
                address.landmark ? `Mo‘ljal: ${address.landmark}` : null,
                address.note ? address.note : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <MiniMap lat={address.lat} lng={address.lng} height={140} editable={false} />
        </div>
      ) : (
        <div className="card mb-4 p-4 text-[12.5px]">
          <p className="mb-1 text-[13px] font-bold">
            {state.checkout.orderType === "pickup" ? "🏃 Olib ketish (Soboy)" : "🍽 Zalda"}
          </p>
          <p className="text-muted">{settings?.address || "VIBE manzili"}</p>
        </div>
      )}

      <div className="card mb-4 space-y-2 p-4 text-[12.5px]">
        <p className="mb-1 text-[13px] font-bold">💳 To‘lov va vaqt</p>
        <Row label="To‘lov turi" value={PAYMENT_LABELS[method] ?? method} />
        {method === "cash" && state.checkout.cashGiven > 0 ? (
          <>
            <Row label="Mijoz beradi" value={formatSum(state.checkout.cashGiven)} />
            <Row label="Qaytim" value={formatSum(Math.max(0, state.checkout.cashGiven - (quote?.total ?? 0)))} bold />
          </>
        ) : null}
        {method === "mixed" ? (
          <>
            <Row label="Naqd" value={formatSum(state.checkout.cashPart)} />
            <Row label="Karta" value={formatSum(state.checkout.cardPart)} />
          </>
        ) : null}
        <Row
          label="Vaqt"
          value={state.checkout.asap ? etaText(quote?.etaMinutes ?? 0) : (state.checkout.scheduledFor ?? "—")}
        />
        {state.checkout.note ? <Row label="Izoh" value={state.checkout.note} /> : null}
      </div>

      <div className="card p-4">
        <Row label="Mahsulotlar" value={formatSum(quote?.itemsTotal ?? 0)} />
        {quote?.promoDiscount ? <Row label="Aksiya chegirmasi" value={`−${formatSum(quote.promoDiscount)}`} tone="mint" /> : null}
        <Row label="Yetkazib berish" value={quote?.deliveryFee ? formatSum(quote.deliveryFee) : "—"} />
        <div className="mt-2 border-t border-white/8 pt-2">
          <Row label="Jami to‘lov" value={formatSum(quote?.total ?? 0)} bold />
        </div>
      </div>

      {state.catalog?.meta.posOnline === false ? (
        <p className="mt-3 rounded-2xl border border-brand/30 bg-brand/10 p-3 text-[11.5px] leading-snug text-brand">
          POS kompyuteri hozir offline. Buyurtma saqlanadi va POS ishga tushgach darhol yuboriladi — yo‘qolmaydi.
        </p>
      ) : null}

      <Button
        className="mt-4 w-full"
        loading={state.submitting}
        disabled={!canSubmit}
        onClick={() => {
          void (async () => {
            const order = await submitOrder();
            if (order) setStep("cart");
          })();
        }}
      >
        Buyurtmani tasdiqlash · {formatSum(quote?.total ?? 0)} so‘m
      </Button>
      <p className="mt-2 text-center text-[11px] text-muted">
        Tasdiqlashdan keyin buyurtma POS “Buyurtmalar” sahifasida paydo bo‘ladi va oshxona cheki chiqadi.
      </p>
    </div>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: "mint" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <span className={`${bold ? "text-[15px] font-extrabold text-brand" : "font-semibold"} ${tone === "mint" ? "text-mint" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <button onClick={onBack} className="tap rounded-full bg-white/8 p-2" aria-label="Orqaga">
        <Icon name="back" className="h-4 w-4" />
      </button>
      <h2 className="text-[16px] font-bold">{title}</h2>
    </div>
  );
}

export type { OrderAddress };
