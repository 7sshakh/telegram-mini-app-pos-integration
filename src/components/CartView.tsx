"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";

import { Button, EmptyState, Icon, Money, QtyStepper, SectionTitle } from "@/components/ui";
import { haptic, hapticNotify } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { formatSum } from "@/lib/format";
import type { OrderAddress, PaymentMethod, PosProduct } from "@/lib/types";

export function CartView() {
  const { state, estimate, setQty, removeItem, clearCart, setCheckout, updatePhone, submitOrder, toast, setTab } = useApp();

  const [addressLine, setAddressLine] = useState(state.checkout.address?.addressLine || "");
  const [apartment, setApartment] = useState(state.checkout.address?.apartment || "");
  const [entrance, setEntrance] = useState(state.checkout.address?.entrance || "");
  const [floor, setFloor] = useState(state.checkout.address?.floor || "");
  const [landmark, setLandmark] = useState(state.checkout.address?.landmark || "");
  const [phone, setPhone] = useState(state.customer?.phone || "");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    state.checkout.address?.lat && state.checkout.address?.lng
      ? { lat: state.checkout.address.lat, lng: state.checkout.address.lng }
      : null,
  );
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState(state.checkout.note || "");
  const [method, setMethod] = useState<PaymentMethod>(state.checkout.paymentMethod || "cash");
  const [submitting, setSubmitting] = useState(false);

  const productById = useMemo(() => {
    const map = new Map<string, PosProduct>();
    for (const product of state.catalog?.products ?? []) map.set(product.id, product);
    return map;
  }, [state.catalog?.products]);

  const itemsTotal = state.cart.reduce((sum, item) => {
    const product = productById.get(item.productId);
    if (!product) return sum;
    const mods = item.modifiers.reduce((modSum, mod) => {
      const modifier = product.modifiers.find((entry) => entry.id === mod.id);
      return modSum + (modifier ? modifier.price * mod.qty : 0);
    }, 0);
    return sum + (product.price + mods) * item.qty;
  }, 0);

  const deliveryFee = 0; // Bepul yetkazib berish
  const grandTotal = itemsTotal + deliveryFee;

  // Auto-sync customer phone if available
  useEffect(() => {
    if (state.customer?.phone && !phone) {
      setPhone(state.customer.phone);
    }
  }, [phone, state.customer?.phone]);

  // GPS Locate function
  const locateMe = () => {
    setLocating(true);
    haptic("light");
    if (!("geolocation" in navigator)) {
      setLocating(false);
      toast("Brauzer lokatsiyani qo‘llab-quvvatlamaydi. Manzilni yozib qoldiring.", "error");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        setCoords({ lat, lng });
        if (!addressLine) {
          setAddressLine(`GPS: ${lat}, ${lng}`);
        }
        setLocating(false);
        hapticNotify("success");
        toast("Aniq GPS lokatsiyangiz aniqlandi! ✓", "ok");
      },
      () => {
        setLocating(false);
        toast("Lokatsiyaga ruxsat berilmadi. Manzilni qo‘lda kiriting.", "error");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  if (state.cart.length === 0) {
    return (
      <div className="px-4 py-8">
        <EmptyState
          emoji="🛒"
          title="Savatchangiz bo‘sh"
          text="Menyudan mazali hotdog, burger yoki ichimlik tanlang."
          action={
            <Button variant="primary" onClick={() => setTab("menu")} className="px-6 py-3 font-bold">
              Menyuga o‘tish ➔
            </Button>
          }
        />
      </div>
    );
  }

  const handleConfirmOrder = async () => {
    if (!addressLine.trim() && !coords) {
      toast("Iltimos, yetkazib berish manzilini kiriting yoki GPS tugmasini bosing.", "error");
      hapticNotify("error");
      return;
    }

    if (!phone.trim()) {
      toast("Iltimos, telefon raqamingizni kiriting.", "error");
      hapticNotify("error");
      return;
    }

    setSubmitting(true);
    haptic("medium");

    if (phone.trim()) {
      void updatePhone(phone.trim());
    }

    const orderAddress: OrderAddress = {
      label: "Yetkazib berish",
      addressLine: addressLine.trim() || `GPS: ${coords?.lat}, ${coords?.lng}`,
      apartment: apartment.trim() || undefined,
      entrance: entrance.trim() || undefined,
      floor: floor.trim() || undefined,
      landmark: landmark.trim() || undefined,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };

    setCheckout({
      orderType: "delivery",
      address: orderAddress,
      paymentMethod: method,
      note: `${phone.trim() ? `Tel: ${phone.trim()} | ` : ""}${note.trim()}`.trim(),
    });

    try {
      const order = await submitOrder();
      if (order) {
        hapticNotify("success");
        setTab("orders");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Buyurtma yuborishda xatolik.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 pb-28 pt-3">
      {/* Top Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-black text-white">Savatcha va Buyurtma</h1>
          <p className="text-[12px] text-white/50">{state.cart.length} xil taom tanlandi</p>
        </div>
        <button
          onClick={clearCart}
          className="tap rounded-xl border border-flame/30 bg-flame/10 px-3 py-1.5 text-[11.5px] font-bold text-flame hover:bg-flame/20"
        >
          Tozalash
        </button>
      </div>

      {/* Cart Items List */}
      <div className="mb-5 space-y-2.5">
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
            <div key={item.key} className="card flex items-stretch gap-3 border border-white/8 bg-ink-soft/80 p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-white/4">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl">🍔</div>
                )}
              </div>
              <div className="min-w-0 flex-1 flex flex-col justify-between">
                <div>
                  <p className="truncate text-[14px] font-bold text-white">{product.name}</p>
                  {modNames ? <p className="text-[11px] text-white/60 line-clamp-1">{modNames}</p> : null}
                  {item.note ? <p className="text-[11px] text-brand/80 italic">“{item.note}”</p> : null}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Money value={unit * item.qty} className="text-[14px] font-extrabold text-brand" />
                  <div className="flex items-center gap-2">
                    <QtyStepper size="sm" value={item.qty} onChange={(next) => setQty(item.key, next)} />
                    <button
                      onClick={() => removeItem(item.key)}
                      className="tap p-1.5 text-white/40 hover:text-flame"
                      aria-label="O‘chirish"
                    >
                      <Icon name="trash" className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* DELIVERY DETAILS FORM (FOCUSED & LARGE) */}
      <div className="mb-5 rounded-3xl border border-brand/20 bg-gradient-to-b from-brand/10 via-white/4 to-white/2 p-4 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-brand text-sm font-black text-black">
            📍
          </span>
          <div>
            <h2 className="text-[16px] font-black text-white">Yetkazib berish manzili</h2>
            <p className="text-[11px] text-white/50">Kuryer tez yetib borishi uchun aniq kiriting</p>
          </div>
        </div>

        {/* Big GPS Auto-Locate Button */}
        <button
          onClick={locateMe}
          disabled={locating}
          className={`tap mb-3 flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 text-[13.5px] font-black transition-all ${
            coords
              ? "bg-mint/20 border border-mint/40 text-mint"
              : "bg-gradient-to-r from-brand to-amber-500 text-black shadow-lg shadow-brand/25 hover:opacity-95"
          }`}
        >
          {locating ? (
            <span>⏳ Lokatsiya aniqlanmoqda...</span>
          ) : coords ? (
            <span>✓ GPS lokatsiyangiz aniqlandi ({coords.lat}, {coords.lng})</span>
          ) : (
            <>
              <span>📍 Mening aniq lokatsiyamni aniqlash (GPS)</span>
            </>
          )}
        </button>

        {/* Address Fields */}
        <div className="space-y-2.5">
          <div>
            <label className="mb-1 block text-[11.5px] font-bold text-white/70">
              Ko‘cha / Uy raqami / Bino:
            </label>
            <input
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              placeholder="Masalan: Chilonzor 9-mavze, 12-uy"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-[13.5px] text-white placeholder-white/30 focus:border-brand focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/60">Podyezd:</label>
              <input
                value={entrance}
                onChange={(e) => setEntrance(e.target.value)}
                placeholder="2"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/60">Qavat:</label>
              <input
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="4"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white focus:border-brand focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/60">Xonadon:</label>
              <input
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                placeholder="45"
                className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-[13px] text-white focus:border-brand focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-bold text-white/70">
              Mo‘ljal (Landmark):
            </label>
            <input
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="Masalan: 4-maktab yaqinida, Makro ro‘parasi"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-[13px] text-white placeholder-white/30 focus:border-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-bold text-white/70">
              Telefon raqamingiz:
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 text-[13.5px] font-bold text-brand placeholder-white/30 focus:border-brand focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11.5px] font-semibold text-white/60">
              Kuryer / Oshxona uchun izoh (ixtiyoriy):
            </label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Masalan: Domofon 45, yetganda telefon qiling"
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 text-[12.5px] text-white placeholder-white/30 focus:border-brand focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* PAYMENT METHOD SELECTOR */}
      <div className="mb-5 rounded-3xl border border-white/8 bg-ink-soft/80 p-4">
        <h3 className="mb-3 text-[14px] font-bold text-white">To‘lov turini tanlang</h3>
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setMethod("cash");
            }}
            className={`tap flex items-center justify-center gap-2 rounded-2xl border p-3 text-[13px] font-bold transition-all ${
              method === "cash"
                ? "border-brand bg-brand/15 text-brand shadow-md shadow-brand/10"
                : "border-white/10 bg-white/4 text-white/60 hover:bg-white/8"
            }`}
          >
            <span className="text-base">💵</span> Naqd pul
          </button>

          <button
            type="button"
            onClick={() => {
              haptic("light");
              setMethod("card_transfer");
            }}
            className={`tap flex items-center justify-center gap-2 rounded-2xl border p-3 text-[13px] font-bold transition-all ${
              method === "card_transfer"
                ? "border-brand bg-brand/15 text-brand shadow-md shadow-brand/10"
                : "border-white/10 bg-white/4 text-white/60 hover:bg-white/8"
            }`}
          >
            <span className="text-base">💳</span> Karta o‘tkazma
          </button>
        </div>
      </div>

      {/* TOTALS & CONFIRM CTA */}
      <div className="rounded-3xl border border-white/10 bg-ink-soft p-4 shadow-2xl">
        <div className="space-y-2 text-[13px]">
          <div className="flex justify-between text-white/60">
            <span>Taomlar jami:</span>
            <span className="font-bold text-white">{formatSum(itemsTotal)} so‘m</span>
          </div>
          <div className="flex justify-between text-white/60">
            <span>Yetkazib berish:</span>
            <span className="font-bold text-mint">Bepul</span>
          </div>
          <div className="flex items-center justify-between border-t border-white/10 pt-2 text-[16px] font-black text-white">
            <span>Jami to‘lov:</span>
            <span className="text-[18px] text-brand">{formatSum(grandTotal)} so‘m</span>
          </div>
        </div>

        <Button
          className="mt-4 w-full py-4 text-[16px] font-black uppercase tracking-wider bg-gradient-to-r from-brand via-amber-400 to-brand-deep text-black shadow-2xl shadow-brand/30"
          loading={submitting}
          disabled={submitting}
          onClick={handleConfirmOrder}
        >
          🚀 Buyurtmani Tasdiqlash · {formatSum(grandTotal)} so‘m
        </Button>
      </div>
    </div>
  );
}
