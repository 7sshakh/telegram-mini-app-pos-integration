"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";

import { EmptyState, Icon, Money, QtyStepper, Sheet, Skeleton, useDebounced } from "@/components/ui";
import { haptic, vibrate } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import type { PosProduct } from "@/lib/types";

const BANNERS = [
  { text: "🔥 Bepul yetkazib berish — Chirchiq bo'ylab!", bg: "from-amber-600/20 to-amber-900/10", border: "border-amber-500/20" },
  { text: "🍔 Eng mazali hotdog va burgerlar — faqat VIBE da!", bg: "from-orange-600/15 to-red-900/10", border: "border-orange-500/15" },
];

export function MenuView() {
  const { state, addToCart, setQty, removeItem, setTab, refreshMenu } = useApp();
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [activeProduct, setActiveProduct] = useState<PosProduct | null>(null);
  const [bannerIdx, setBannerIdx] = useState(0);
  const debouncedQuery = useDebounced(query, 180);

  const categories = state.catalog?.categories ?? [];
  const products = state.catalog?.products ?? [];

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (!p.isAvailable) return false;
      if (category !== "all" && p.categoryId !== category) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q);
    });
  }, [category, debouncedQuery, products]);

  if (state.catalogLoading) {
    return (
      <div className="px-3 pt-3 space-y-2.5">
        <Skeleton className="h-9 w-full" />
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="px-4 py-10">
        <EmptyState emoji="🍽️" title="Menyu yuklanmoqda" text="Bir necha soniya kuting..."
          action={<button onClick={() => void refreshMenu()} className="tap btn-ghost px-4 py-2 text-xs font-semibold">Qayta yuklash</button>}
        />
      </div>
    );
  }

  return (
    <div className="pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[#0a0a0b]/95 backdrop-blur-md px-3 pb-2 pt-3 border-b border-white/4">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-[16px] font-bold text-white tracking-tight">VIBE</h1>
          <span className="text-[10px] font-medium text-zinc-500">HotDog · Burger · Drinks</span>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <Icon name="search" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Qidirish..."
            className="w-full rounded-lg border-0 bg-[#161618] py-1.5 pl-8 pr-7 text-[12.5px] text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          />
          {query && <button onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-zinc-500">✕</button>}
        </div>

        {/* Categories */}
        <div className="no-scrollbar -mx-3 flex gap-1 overflow-x-auto px-3">
          <button onClick={() => setCategory("all")}
            className={`tap shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${category === "all" ? "bg-amber-500 text-black" : "bg-[#161618] text-zinc-400"}`}>
            Barchasi
          </button>
          {categories.map((c) => (
            <button key={c.id} onClick={() => { haptic("light"); setCategory(c.id); }}
              className={`tap shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-semibold ${category === c.id ? "bg-amber-500 text-black" : "bg-[#161618] text-zinc-400"}`}>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Banner */}
      <div className="px-3 mt-2.5 mb-1">
        <button
          onClick={() => setBannerIdx((i) => (i + 1) % BANNERS.length)}
          className={`tap w-full rounded-xl border ${BANNERS[bannerIdx].border} bg-gradient-to-r ${BANNERS[bannerIdx].bg} px-3.5 py-2.5 text-left`}
        >
          <p className="text-[12.5px] font-bold text-white leading-snug">{BANNERS[bannerIdx].text}</p>
          <p className="mt-0.5 text-[10px] text-zinc-400">Hoziroq buyurtma bering ➔</p>
        </button>
      </div>

      {/* 2-Column Grid */}
      <div className="px-3 mt-2">
        {filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="Topilmadi" text="Boshqa so'z bilan qidiring." />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((product, idx) => {
              const cartItem = state.cart.find((c) => c.productId === product.id && c.modifiers.length === 0);
              const inCartQty = cartItem ? cartItem.qty : 0;
              return (
                <GridCard
                  key={product.id}
                  product={product}
                  cartQty={inCartQty}
                  delay={idx * 30}
                  onOpen={() => setActiveProduct(product)}
                  onAdd={() => { addToCart(product, 1, []); vibrate(10); }}
                  onIncrease={() => { if (cartItem) { setQty(cartItem.key, cartItem.qty + 1); vibrate(8); } }}
                  onDecrease={() => {
                    if (!cartItem) return;
                    if (cartItem.qty <= 1) removeItem(cartItem.key);
                    else setQty(cartItem.key, cartItem.qty - 1);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <ProductSheet product={activeProduct} onClose={() => setActiveProduct(null)}
        onAdded={() => { setActiveProduct(null); setTab("cart"); }} />
    </div>
  );
}

function GridCard({ product, cartQty, delay, onOpen, onAdd, onIncrease, onDecrease }: {
  product: PosProduct; cartQty: number; delay: number;
  onOpen: () => void; onAdd: () => void; onIncrease: () => void; onDecrease: () => void;
}) {
  const hasModifiers = product.modifiers.length > 0;

  return (
    <div className="card-animate overflow-hidden rounded-xl border border-white/4 bg-[#131315]"
      style={{ animationDelay: `${Math.min(delay, 300)}ms` }}>
      {/* Image */}
      <button onClick={onOpen} className="tap relative block w-full aspect-[4/3] overflow-hidden bg-[#1a1a1d]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl">🍔</div>
        )}
      </button>

      {/* Info */}
      <div className="p-2">
        <button onClick={onOpen} className="text-left w-full">
          <p className="text-[12.5px] font-semibold text-white leading-tight line-clamp-1">{product.name}</p>
          {product.description && (
            <p className="mt-0.5 text-[10px] text-zinc-500 leading-snug line-clamp-2">{product.description}</p>
          )}
        </button>

        <div className="mt-1.5 flex items-center justify-between">
          <Money value={product.price} className="text-[12.5px] font-bold text-amber-400" />

          {hasModifiers ? (
            <button onClick={onOpen}
              className="tap rounded-md bg-[#1e1e22] px-2 py-0.5 text-[10px] font-semibold text-zinc-300 border border-white/5">
              Tanlash
            </button>
          ) : cartQty > 0 ? (
            <div className="flex items-center gap-1 rounded-md bg-[#1a1a1d] px-0.5 py-0.5 border border-white/5">
              <button onClick={onDecrease} className="tap flex h-5 w-5 items-center justify-center rounded bg-zinc-700 text-[10px] font-bold text-white">−</button>
              <span className="text-[10px] font-bold text-white px-0.5 min-w-[14px] text-center">{cartQty}</span>
              <button onClick={onIncrease} className="tap flex h-5 w-5 items-center justify-center rounded bg-amber-500 text-[10px] font-bold text-black">+</button>
            </div>
          ) : (
            <button onClick={onAdd}
              className="tap flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-black font-bold text-sm">
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductSheet({ product, onClose, onAdded }: {
  product: PosProduct | null; onClose: () => void; onAdded: () => void;
}) {
  const { addToCart } = useApp();
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");

  const groups = useMemo(() => {
    if (!product) return [] as { name: string; modifiers: PosProduct["modifiers"] }[];
    const map = new Map<string, PosProduct["modifiers"]>();
    for (const m of product.modifiers) {
      const key = m.groupName ?? "Qo'shimchalar";
      map.set(key, [...(map.get(key) ?? []), m]);
    }
    return [...map.entries()].map(([name, modifiers]) => ({ name, modifiers }));
  }, [product]);

  if (!product) return null;

  const unitPrice = product.price + Object.entries(selected).reduce((sum, [id, count]) => {
    const m = product.modifiers.find((item) => item.id === id);
    return sum + (m ? m.price * count : 0);
  }, 0);
  const total = unitPrice * qty;

  return (
    <Sheet open={!!product} onClose={onClose} title={product.name} subtitle={product.description}
      footer={
        <div className="flex items-center gap-3">
          <QtyStepper value={qty} min={1} max={50} onChange={(n) => setQty(Math.max(1, n))} />
          <button onClick={() => {
            addToCart(product, qty,
              Object.entries(selected).filter(([, c]) => c > 0).map(([id, c]) => ({ id, qty: c })),
              note.trim() || undefined);
            vibrate(12);
            onAdded();
          }} className="tap btn-primary flex-1 py-2.5 text-[13px] font-bold">
            Qo'shish · {total.toLocaleString("ru-RU")} so'm
          </button>
        </div>
      }
    >
      <div className="mb-3 h-[140px] overflow-hidden rounded-lg bg-[#1a1a1d]">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl">🌭</div>
        )}
      </div>

      <Money value={product.price} className="text-[15px] font-bold text-amber-400 mb-3 block" />

      {groups.map((group) => (
        <div key={group.name} className="mb-2.5">
          <p className="mb-1 text-[10.5px] font-bold text-zinc-500 uppercase tracking-wider">{group.name}</p>
          <div className="space-y-1">
            {group.modifiers.map((m) => {
              const count = selected[m.id] ?? 0;
              return (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-[#161618] px-2.5 py-1.5">
                  <div>
                    <p className="text-[12px] font-medium text-white">{m.name}</p>
                    <p className="text-[10px] text-zinc-500">{m.price > 0 ? `+${m.price.toLocaleString("ru-RU")} so'm` : "Bepul"}</p>
                  </div>
                  {count === 0 ? (
                    <button onClick={() => { haptic("light"); setSelected((p) => ({ ...p, [m.id]: 1 })); }}
                      className="tap rounded px-2 py-0.5 text-[10px] font-semibold text-zinc-400 bg-[#1e1e22] border border-white/5">
                      + Qo'shish
                    </button>
                  ) : (
                    <QtyStepper size="sm" value={count} max={m.maxQty ?? 5}
                      onChange={(n) => setSelected((p) => { const c = { ...p }; if (n <= 0) delete c[m.id]; else c[m.id] = n; return c; })} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mb-1">
        <p className="mb-1 text-[10.5px] font-bold text-zinc-500 uppercase tracking-wider">Izoh</p>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={200}
          placeholder="Oshxona uchun maxsus istak..."
          className="w-full rounded-lg border border-white/5 bg-[#161618] p-2 text-[12px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none" />
      </div>
    </Sheet>
  );
}
