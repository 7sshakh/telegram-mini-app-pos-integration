"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";

import { Button, EmptyState, Icon, Money, QtyStepper } from "@/components/ui";
import { haptic, hapticNotify, requestContact, vibrate, alertInTelegram } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { formatSum } from "@/lib/format";
import type { OrderAddress, PaymentMethod, PosProduct } from "@/lib/types";

// Chirchiq city bounding box (approximate)
const CHIRCHIQ_BOUNDS = {
  minLat: 41.44, maxLat: 41.50,
  minLng: 69.52, maxLng: 69.63,
};
const CHIRCHIQ_CENTER = { lat: 41.4689, lng: 69.5822 };

function isInChirchiq(lat: number, lng: number): boolean {
  return lat >= CHIRCHIQ_BOUNDS.minLat && lat <= CHIRCHIQ_BOUNDS.maxLat &&
    lng >= CHIRCHIQ_BOUNDS.minLng && lng <= CHIRCHIQ_BOUNDS.maxLng;
}

export function CartView() {
  const { state, setQty, removeItem, clearCart, setCheckout, updatePhone, submitOrder, toast, setTab } = useApp();

  const [addressLine, setAddressLine] = useState(state.checkout.address?.addressLine || "");
  const [apartment, setApartment] = useState(state.checkout.address?.apartment || "");
  const [entrance, setEntrance] = useState(state.checkout.address?.entrance || "");
  const [floor, setFloor] = useState(state.checkout.address?.floor || "");
  const [landmark, setLandmark] = useState(state.checkout.address?.landmark || "");
  const [phone, setPhone] = useState(state.customer?.phone || "");
  const [phoneShared, setPhoneShared] = useState(!!state.customer?.phone);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    state.checkout.address?.lat && state.checkout.address?.lng
      ? { lat: state.checkout.address.lat, lng: state.checkout.address.lng }
      : null,
  );
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState(state.checkout.note || "");
  const [method, setMethod] = useState<PaymentMethod>(state.checkout.paymentMethod || "cash");
  const [submitting, setSubmitting] = useState(false);
  const [orderSuccess, setOrderSuccess] = useState(false);
  const [mapSearch, setMapSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ display_name: string; lat: string; lon: string }>>([]);
  const [searching, setSearching] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  const productById = useMemo(() => {
    const map = new Map<string, PosProduct>();
    for (const p of state.catalog?.products ?? []) map.set(p.id, p);
    return map;
  }, [state.catalog?.products]);

  const itemsTotal = state.cart.reduce((sum, item) => {
    const p = productById.get(item.productId);
    if (!p) return sum;
    const mods = item.modifiers.reduce((ms, mod) => {
      const m = p.modifiers.find((e) => e.id === mod.id);
      return ms + (m ? m.price * mod.qty : 0);
    }, 0);
    return sum + (p.price + mods) * item.qty;
  }, 0);

  useEffect(() => {
    if (state.customer?.phone && !phone) {
      setPhone(state.customer.phone);
      setPhoneShared(true);
    }
  }, [phone, state.customer?.phone]);

  const handleShareContact = async () => {
    haptic("medium");
    const ok = await requestContact();
    if (ok) {
      // After requestContact succeeds, the phone should be updated via the backend
      // We'll refresh profile to get the phone
      setPhoneShared(true);
      toast("Telefon raqamingiz ulashildi ✓", "ok");
      hapticNotify("success");
      // Phone will be available from state.customer.phone after profile refresh
      setTimeout(() => {
        if (state.customer?.phone) setPhone(state.customer.phone);
      }, 1000);
    } else {
      toast("Telefon raqamni ulashing. Bu majburiy.", "error");
      hapticNotify("error");
    }
  };

  const locateMe = () => {
    setLocating(true);
    haptic("light");
    if (!("geolocation" in navigator)) {
      setLocating(false);
      toast("GPS qo'llab-quvvatlanmaydi. Manzilni kiriting.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        if (!isInChirchiq(lat, lng)) {
          setLocating(false);
          toast("Hozircha faqat Chirchiq shahri ichida yetkazamiz.", "error");
          hapticNotify("error");
          return;
        }
        setCoords({ lat, lng });
        if (!addressLine) setAddressLine(`GPS: ${lat}, ${lng}`);
        setLocating(false);
        hapticNotify("success");
        vibrate(12);
        toast("Lokatsiya aniqlandi ✓", "ok");
      },
      () => {
        setLocating(false);
        toast("Lokatsiya ruxsati berilmadi.", "error");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };

  const searchAddress = async () => {
    if (!mapSearch.trim()) return;
    setSearching(true);
    try {
      const q = encodeURIComponent(`${mapSearch.trim()}, Chirchiq, Toshkent viloyati, Uzbekistan`);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=5&bounded=1&viewbox=${CHIRCHIQ_BOUNDS.minLng},${CHIRCHIQ_BOUNDS.maxLat},${CHIRCHIQ_BOUNDS.maxLng},${CHIRCHIQ_BOUNDS.minLat}`);
      const data = await res.json();
      setSearchResults(data);
    } catch {
      toast("Qidirishda xatolik.", "error");
    } finally {
      setSearching(false);
    }
  };

  const selectSearchResult = (result: { display_name: string; lat: string; lon: string }) => {
    const lat = Number(result.lat);
    const lng = Number(result.lon);
    if (!isInChirchiq(lat, lng)) {
      toast("Bu manzil Chirchiq shahridan tashqarida.", "error");
      return;
    }
    setCoords({ lat, lng });
    setAddressLine(result.display_name.split(",").slice(0, 3).join(",").trim());
    setSearchResults([]);
    setMapSearch("");
    haptic("light");
    toast("Manzil tanlandi ✓", "ok");
  };

  if (state.cart.length === 0 && !orderSuccess) {
    return (
      <div className="px-4 py-10">
        <EmptyState emoji="🛒" title="Savatchangiz bo'sh" text="Menyudan taom tanlang."
          action={<Button variant="primary" onClick={() => setTab("menu")} className="px-5 py-2 text-xs font-bold">Menyuga o'tish ➔</Button>} />
      </div>
    );
  }

  // Success screen after order
  if (orderSuccess) {
    return (
      <div className="px-4 py-12 text-center">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-[18px] font-bold text-white mb-2">Buyurtma qabul qilindi!</h2>
        <p className="text-[13px] text-zinc-400 leading-relaxed mb-6 max-w-xs mx-auto">
          Buyurtmangizni tasdiqlash uchun sizga <span className="text-amber-400 font-bold">+998 97 911 80 70</span> raqamidan qo'ng'iroq qilamiz.
        </p>
        <div className="space-y-2">
          <Button variant="primary" onClick={() => { setOrderSuccess(false); setTab("orders"); }} className="w-full py-2.5 text-[13px]">
            Buyurtmani kuzatish
          </Button>
          <Button variant="ghost" onClick={() => { setOrderSuccess(false); setTab("menu"); }} className="w-full py-2.5 text-[13px]">
            Menyuga qaytish
          </Button>
        </div>
      </div>
    );
  }

  const handleConfirmOrder = async () => {
    if (!phoneShared && !phone.trim()) {
      toast("Iltimos, telefon raqamingizni ulashing.", "error");
      hapticNotify("error");
      return;
    }
    if (!addressLine.trim() && !coords) {
      toast("Iltimos, manzilni kiriting yoki GPS bosing.", "error");
      hapticNotify("error");
      return;
    }
    if (coords && !isInChirchiq(coords.lat, coords.lng)) {
      toast("Hozircha faqat Chirchiq shahri ichida yetkazamiz.", "error");
      hapticNotify("error");
      return;
    }

    setSubmitting(true);
    haptic("medium");

    if (phone.trim()) void updatePhone(phone.trim());

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
        vibrate([50, 80, 50]);
        setOrderSuccess(true);
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : "Xatolik.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="px-3 pb-24 pt-2.5 max-w-lg mx-auto">
      {/* Header */}
      <div className="mb-2.5 flex items-center justify-between">
        <h1 className="text-[15px] font-bold text-white">Savatcha ({state.cart.length})</h1>
        <button onClick={clearCart} className="tap text-[11px] font-semibold text-red-400">Tozalash</button>
      </div>

      {/* Cart Items */}
      <div className="mb-3 space-y-1">
        {state.cart.map((item) => {
          const p = productById.get(item.productId);
          if (!p) return null;
          const modNames = item.modifiers.map((mod) => {
            const m = p.modifiers.find((e) => e.id === mod.id);
            return m ? m.name : null;
          }).filter(Boolean).join(", ");
          const unit = p.price + item.modifiers.reduce((s, mod) => {
            const m = p.modifiers.find((e) => e.id === mod.id);
            return s + (m ? m.price * mod.qty : 0);
          }, 0);

          return (
            <div key={item.key} className="flex items-center gap-2.5 rounded-xl border border-white/4 bg-[#131315] p-2">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#1a1a1d]">
                {p.imageUrl ? <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" /> :
                  <div className="flex h-full items-center justify-center text-xl">🍔</div>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-1">
                  <p className="truncate text-[12.5px] font-semibold text-white">{p.name}</p>
                  <button onClick={() => removeItem(item.key)} className="tap text-zinc-600 p-0.5">
                    <Icon name="trash" className="h-3 w-3" />
                  </button>
                </div>
                {modNames && <p className="text-[10px] text-zinc-500 truncate">{modNames}</p>}
                <div className="mt-0.5 flex items-center justify-between">
                  <Money value={unit * item.qty} className="text-[12px] font-bold text-amber-400" />
                  <div className="flex items-center gap-1 rounded bg-[#1a1a1d] px-0.5 py-0.5 border border-white/4">
                    <button onClick={() => { if (item.qty <= 1) removeItem(item.key); else setQty(item.key, item.qty - 1); }}
                      className="tap flex h-4.5 w-4.5 items-center justify-center rounded bg-zinc-700 text-[9px] font-bold text-white">−</button>
                    <span className="text-[10px] font-bold text-white px-1">{item.qty}</span>
                    <button onClick={() => setQty(item.key, item.qty + 1)}
                      className="tap flex h-4.5 w-4.5 items-center justify-center rounded bg-amber-500 text-[9px] font-bold text-black">+</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* PHONE — Share Contact */}
      <div className="mb-3 rounded-xl border border-white/4 bg-[#131315] p-3">
        <h3 className="text-[12px] font-bold text-white mb-2 flex items-center gap-1.5">
          <span>📞</span> Telefon raqam
        </h3>
        {phoneShared || phone ? (
          <div className="flex items-center justify-between rounded-lg bg-[#1a1a1d] px-3 py-2 border border-white/5">
            <span className="text-[13px] font-bold text-amber-400">{phone || state.customer?.phone || "Ulashildi"}</span>
            <span className="text-[10px] text-zinc-500">✓</span>
          </div>
        ) : (
          <button onClick={handleShareContact}
            className="tap w-full flex items-center justify-center gap-2 rounded-lg bg-[#1e1e22] py-2.5 text-[12px] font-bold text-white border border-white/6 hover:border-amber-500/30">
            📞 Telefon raqamni ulashish (majburiy)
          </button>
        )}
      </div>

      {/* ADDRESS with Map Search */}
      <div className="mb-3 rounded-xl border border-white/4 bg-[#131315] p-3 space-y-2">
        <h3 className="text-[12px] font-bold text-white flex items-center gap-1.5">
          <span>📍</span> Yetkazib berish manzili
          {coords && <span className="text-[9px] text-amber-400 ml-auto">GPS ✓</span>}
        </h3>

        {/* GPS Button */}
        <button onClick={locateMe} disabled={locating}
          className={`tap flex w-full items-center justify-center gap-1.5 rounded-lg py-2 text-[11.5px] font-bold border ${
            coords ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : "bg-[#1e1e22] text-zinc-300 border-white/5"
          }`}>
          {locating ? "⏳ Aniqlanmoqda..." : coords ? "✓ GPS lokatsiya olindi" : "📍 Joylashuvimni aniqlash (GPS)"}
        </button>

        {/* Map Search */}
        <div className="relative">
          <input value={mapSearch} onChange={(e) => setMapSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void searchAddress(); }}
            placeholder="Manzilni qidirish (masalan: Amir Temur)"
            className="w-full rounded-lg border border-white/6 bg-[#161618] px-3 py-2 text-[12px] text-white placeholder-zinc-500 pr-16 focus:border-amber-500 focus:outline-none" />
          <button onClick={() => void searchAddress()} disabled={searching}
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-black">
            {searching ? "..." : "Qidirish"}
          </button>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="rounded-lg border border-white/6 bg-[#161618] overflow-hidden max-h-32 overflow-y-auto">
            {searchResults.map((r, i) => (
              <button key={i} onClick={() => selectSearchResult(r)}
                className="tap w-full text-left px-2.5 py-1.5 text-[11px] text-zinc-300 border-b border-white/4 last:border-0 hover:bg-white/4">
                📍 {r.display_name.split(",").slice(0, 3).join(",")}
              </button>
            ))}
          </div>
        )}

        {/* Mini Map Display */}
        {coords && (
          <div ref={mapRef} className="rounded-lg overflow-hidden border border-white/6 h-28">
            <iframe
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng - 0.005},${coords.lat - 0.003},${coords.lng + 0.005},${coords.lat + 0.003}&layer=mapnik&marker=${coords.lat},${coords.lng}`}
              className="w-full h-full border-0"
              loading="lazy"
              title="Xarita"
            />
          </div>
        )}

        <p className="text-[9px] text-zinc-500 text-center">⚠️ Hozircha faqat Chirchiq shahri ichida yetkazamiz</p>

        {/* Address Fields */}
        <input value={addressLine} onChange={(e) => setAddressLine(e.target.value)}
          placeholder="Ko'cha, uy raqami" className="text-[12px]" />

        <div className="grid grid-cols-3 gap-1.5">
          <input value={entrance} onChange={(e) => setEntrance(e.target.value)} placeholder="Podyezd" className="text-[11px]" />
          <input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Qavat" className="text-[11px]" />
          <input value={apartment} onChange={(e) => setApartment(e.target.value)} placeholder="Xonadon" className="text-[11px]" />
        </div>

        <input value={landmark} onChange={(e) => setLandmark(e.target.value)}
          placeholder="Mo'ljal (masalan: Makro yaqinida)" className="text-[12px]" />
        <input value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Kuryer uchun izoh (ixtiyoriy)" className="text-[11px]" />
      </div>

      {/* Payment */}
      <div className="mb-3 rounded-xl border border-white/4 bg-[#131315] p-3">
        <h3 className="mb-1.5 text-[10.5px] font-bold text-zinc-500 uppercase tracking-wider">To'lov</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {(["cash", "card_transfer"] as PaymentMethod[]).map((m) => (
            <button key={m} type="button" onClick={() => { haptic("light"); setMethod(m); }}
              className={`tap flex items-center justify-center gap-1 rounded-lg py-2 text-[11.5px] font-semibold border ${
                method === m ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-white/4 bg-[#161618] text-zinc-400"
              }`}>
              {m === "cash" ? "💵 Naqd" : "💳 Karta"}
            </button>
          ))}
        </div>
      </div>

      {/* Confirm */}
      <div className="rounded-xl border border-white/4 bg-[#131315] p-3 space-y-2">
        <div className="flex items-center justify-between text-[14px] font-bold text-white">
          <span>Jami:</span>
          <span className="text-amber-400">{formatSum(itemsTotal)} so'm</span>
        </div>
        <Button className="w-full py-3 text-[13.5px] font-bold bg-amber-500 text-black rounded-lg"
          loading={submitting} disabled={submitting} onClick={handleConfirmOrder}>
          Buyurtmani tasdiqlash · {formatSum(itemsTotal)} so'm
        </Button>
      </div>
    </div>
  );
}
