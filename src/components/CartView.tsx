"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";

import { Button, EmptyState, Icon, Money, QtyStepper } from "@/components/ui";
import { haptic, hapticNotify } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { formatSum } from "@/lib/format";
import type { OrderAddress, PaymentMethod, PosProduct } from "@/lib/types";

export function CartView() {
  const { state, setQty, removeItem, clearCart, setCheckout, updatePhone, submitOrder, toast, setTab } = useApp();

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

  const grandTotal = itemsTotal;

  useEffect(() => {
    if (state.customer?.phone && !phone) {
      setPhone(state.customer.phone);
    }
  }, [phone, state.customer?.phone]);

  const locateMe = () => {
    setLocating(true);
    haptic("light");
    if (!("geolocation" in navigator)) {
      setLocating(false);
      toast("Brauzer lokatsiyani qo‘llab-quvvatlamaydi. Manzilni yozing.", "error");
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
        toast("Lokatsiya aniqlandi ✓", "ok");
      },
      () => {
        setLocating(false);
        toast("Lokatsiya ruxsati berilmadi. Manzilni qo‘lda kiriting.", "error");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  if (state.cart.length === 0) {
    return (
      <div className="px-4 py-12">
        <EmptyState
          emoji="🛒"
          title="Savatchangiz bo‘sh"
          text="Menyudan taom tanlang."
          action={
            <Button variant="primary" onClick={() => setTab("menu")} className="px-5 py-2.5 text-xs font-bold">
              Menyuga o‘tish ➔
            </Button>
          }
        />
      </div>
    );
  }

  const handleConfirmOrder = async () => {
    if (!addressLine.trim() && !coords) {
      toast("Iltimos, manzilni kiriting yoki GPS tugmasini bosing.", "error");
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
      toast(error instanceof Error ? error.message : "Xatolik yuz berdi.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-4 pb-28 pt-3 max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-[17px] font-bold text-white">Savatcha ({state.cart.length})</h1>
        <button
          onClick={clearCart}
          className="tap text-[11.5px] font-semibold text-red-400 hover:text-red-300"
        >
          Tozalash
        </button>
      </div>

      {/* Cart Items List */}
      <div className="mb-4 space-y-1.5">
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
            <div key={item.key} className="flex items-center gap-3 rounded-2xl border border-white/5 bg-[#141518] p-2.5">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[#1c1d22]">
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl">🍔</div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <p className="truncate text-[13.5px] font-semibold text-white">{product.name}</p>
                  <button
                    onClick={() => removeItem(item.key)}
                    className="tap text-zinc-500 hover:text-red-400 p-0.5"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
                {modNames && <p className="text-[11px] text-zinc-400 truncate">{modNames}</p>}
                <div className="mt-1 flex items-center justify-between">
                  <Money value={unit * item.qty} className="text-[13px] font-bold text-amber-400" />
                  <div className="flex items-center gap-1.5 rounded-lg bg-[#1c1d22] px-1 py-0.5 border border-white/5">
                    <button
                      onClick={() => {
                        if (item.qty <= 1) removeItem(item.key);
                        else setQty(item.key, item.qty - 1);
                      }}
                      className="tap flex h-5 w-5 items-center justify-center rounded bg-zinc-800 text-xs font-bold text-white"
                    >
                      −
                    </button>
                    <span className="text-xs font-bold text-white px-1">{item.qty}</span>
                    <button
                      onClick={() => setQty(item.key, item.qty + 1)}
                      className="tap flex h-5 w-5 items-center justify-center rounded bg-amber-500 text-xs font-bold text-black"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* DELIVERY DETAILS FORM */}
      <div className="mb-4 rounded-2xl border border-white/5 bg-[#141518] p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-white flex items-center gap-1.5">
            <span>📍</span> Yetkazib berish manzili
          </h2>
          {coords && <span className="text-[11px] font-semibold text-emerald-400">✓ GPS faol</span>}
        </div>

        {/* GPS Locate Button */}
        <button
          onClick={locateMe}
          disabled={locating}
          className={`tap flex w-full items-center justify-center gap-2 rounded-xl py-2.5 px-3 text-[12.5px] font-bold transition-all ${
            coords
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-[#22232a] text-zinc-200 border border-white/8 hover:border-amber-500/50"
          }`}
        >
          {locating ? "⏳ Aniqlanmoqda..." : coords ? "✓ GPS lokatsiyangiz olindi" : "📍 Joylashuvimni aniqlash (GPS)"}
        </button>

        {/* Form Inputs */}
        <div className="space-y-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-400">Manzil / Ko‘cha va bino:</label>
            <input
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              placeholder="Masalan: Chilonzor 9, 12-uy"
              className="w-full rounded-xl border border-white/8 bg-[#18191d] px-3 py-2 text-[13px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-1 block text-[10.5px] font-medium text-zinc-400">Podyezd:</label>
              <input
                value={entrance}
                onChange={(e) => setEntrance(e.target.value)}
                placeholder="2"
                className="w-full rounded-xl border border-white/8 bg-[#18191d] px-2.5 py-1.5 text-[12.5px] text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10.5px] font-medium text-zinc-400">Qavat:</label>
              <input
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                placeholder="4"
                className="w-full rounded-xl border border-white/8 bg-[#18191d] px-2.5 py-1.5 text-[12.5px] text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10.5px] font-medium text-zinc-400">Xonadon:</label>
              <input
                value={apartment}
                onChange={(e) => setApartment(e.target.value)}
                placeholder="45"
                className="w-full rounded-xl border border-white/8 bg-[#18191d] px-2.5 py-1.5 text-[12.5px] text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-400">Mo‘ljal (ixtiyoriy):</label>
            <input
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="Masalan: Makro ro‘parasi"
              className="w-full rounded-xl border border-white/8 bg-[#18191d] px-3 py-2 text-[12.5px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-400">Telefon raqam:</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998 90 123 45 67"
              className="w-full rounded-xl border border-white/8 bg-[#18191d] px-3 py-2 text-[13px] font-bold text-amber-400 placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-400">Kuryer uchun izoh:</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Masalan: Domofon 45"
              className="w-full rounded-xl border border-white/8 bg-[#18191d] px-3 py-2 text-[12.5px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* PAYMENT METHOD */}
      <div className="mb-4 rounded-2xl border border-white/5 bg-[#141518] p-3.5">
        <h3 className="mb-2 text-[12px] font-bold text-zinc-400 uppercase tracking-wider">To‘lov turi</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setMethod("cash");
            }}
            className={`tap flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-semibold border transition-all ${
              method === "cash"
                ? "border-amber-500 bg-amber-500/10 text-amber-400"
                : "border-white/5 bg-[#18191d] text-zinc-400"
            }`}
          >
            💵 Naqd pul
          </button>
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setMethod("card_transfer");
            }}
            className={`tap flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-semibold border transition-all ${
              method === "card_transfer"
                ? "border-amber-500 bg-amber-500/10 text-amber-400"
                : "border-white/5 bg-[#18191d] text-zinc-400"
            }`}
          >
            💳 Karta o‘tkazma
          </button>
        </div>
      </div>

      {/* CONFIRM BUTTON */}
      <div className="rounded-2xl border border-white/5 bg-[#141518] p-3.5 space-y-2.5">
        <div className="flex items-center justify-between text-[15px] font-bold text-white">
          <span>Jami:</span>
          <span className="text-[17px] text-amber-400">{formatSum(grandTotal)} so‘m</span>
        </div>

        <Button
          className="w-full py-3.5 text-[14.5px] font-bold bg-amber-500 text-black hover:bg-amber-400 rounded-xl"
          loading={submitting}
          disabled={submitting}
          onClick={handleConfirmOrder}
        >
          Buyurtmani tasdiqlash · {formatSum(grandTotal)} so‘m
        </Button>
      </div>
    </div>
  );
}
