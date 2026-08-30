"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";

import { EmptyState, Icon, Money, QtyStepper, SectionTitle, Sheet, Skeleton, useDebounced } from "@/components/ui";
import { haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import type { PosProduct } from "@/lib/types";

export function MenuView() {
  const { state, addToCart, setQty, removeItem, setTab, refreshMenu } = useApp();
  const [category, setCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [activeProduct, setActiveProduct] = useState<PosProduct | null>(null);
  const debouncedQuery = useDebounced(query, 180);

  const categories = state.catalog?.categories ?? [];
  const products = state.catalog?.products ?? [];

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    return products.filter((product) => {
      if (!product.isAvailable) return false;
      if (category !== "all" && product.categoryId !== category) return false;
      if (!q) return true;
      return (
        product.name.toLowerCase().includes(q) ||
        (product.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [category, debouncedQuery, products]);

  if (state.catalogLoading) {
    return (
      <div className="px-4 pt-3 space-y-3">
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="flex gap-2 overflow-x-hidden">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-lg" />
          ))}
        </div>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="px-4 py-12">
        <EmptyState
          emoji="🍽️"
          title="Menyu yuklanmoqda"
          text="Iltimos bir necha soniya kuting..."
          action={
            <button onClick={() => void refreshMenu()} className="tap btn-ghost px-4 py-2 text-xs font-semibold">
              Qayta yuklash
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div className="pb-24">
      {/* Minimal Header & Search */}
      <div className="sticky top-0 z-20 bg-[#0c0d0e]/95 px-4 pb-2.5 pt-3 backdrop-blur-lg border-b border-white/5">
        <div className="mb-2.5 flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold tracking-tight text-white">VIBE</h1>
            <p className="text-[11px] text-zinc-400">HotDog · Burger · Drinks</p>
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-400 border border-emerald-500/20">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Ochiq
          </div>
        </div>

        {/* Minimal Search Input */}
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Qidirish..."
            className="w-full rounded-xl border border-white/8 bg-[#16171a] py-2 pl-9 pr-8 text-[13.5px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
              ✕
            </button>
          )}
        </div>

        {/* Minimal Category Chips */}
        <div className="no-scrollbar -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
          <button
            onClick={() => setCategory("all")}
            className={`tap shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              category === "all"
                ? "bg-amber-500 text-black font-bold"
                : "bg-[#16171a] text-zinc-400 border border-white/5 hover:text-white"
            }`}
          >
            Barchasi
          </button>
          {categories.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                haptic("light");
                setCategory(item.id);
              }}
              className={`tap shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                category === item.id
                  ? "bg-amber-500 text-black font-bold"
                  : "bg-[#16171a] text-zinc-400 border border-white/5 hover:text-white"
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>
      </div>

      {/* Food List */}
      <div className="mt-3 px-4">
        {filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="Topilmadi" text="Boshqa so‘z bilan qidirib ko‘ring." />
        ) : (
          <div className="space-y-2">
            {filtered.map((product) => {
              const cartItem = state.cart.find((c) => c.productId === product.id && c.modifiers.length === 0);
              const inCartQty = cartItem ? cartItem.qty : 0;
              return (
                <ProductRow
                  key={product.id}
                  product={product}
                  cartQty={inCartQty}
                  onOpen={() => setActiveProduct(product)}
                  onAdd={() => addToCart(product, 1, [])}
                  onIncrease={() => cartItem && setQty(cartItem.key, cartItem.qty + 1)}
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

      {/* Product Details Sheet */}
      <ProductSheet
        product={activeProduct}
        onClose={() => setActiveProduct(null)}
        onAdded={() => {
          setActiveProduct(null);
          setTab("cart");
        }}
      />
    </div>
  );
}

function ProductRow({
  product,
  cartQty,
  onOpen,
  onAdd,
  onIncrease,
  onDecrease,
}: {
  product: PosProduct;
  cartQty: number;
  onOpen: () => void;
  onAdd: () => void;
  onIncrease: () => void;
  onDecrease: () => void;
}) {
  const hasModifiers = product.modifiers.length > 0;

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/5 bg-[#141518] p-2.5 transition-colors">
      {/* Product Thumbnail */}
      <button
        onClick={onOpen}
        className="tap relative h-18 w-18 shrink-0 overflow-hidden rounded-xl bg-[#1c1d22]"
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl">🍔</div>
        )}
      </button>

      {/* Product Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between self-stretch py-0.5">
        <button onClick={onOpen} className="text-left">
          <p className="line-clamp-1 text-[14px] font-semibold text-white">{product.name}</p>
          {product.description && (
            <p className="mt-0.5 line-clamp-1 text-[11.5px] text-zinc-400 leading-snug">{product.description}</p>
          )}
        </button>

        <div className="mt-1 flex items-center justify-between">
          <Money value={product.price} className="text-[14px] font-bold text-amber-400" />

          {/* Action Button */}
          {hasModifiers ? (
            <button
              onClick={onOpen}
              className="tap rounded-lg bg-[#22232a] px-3 py-1 text-[11.5px] font-semibold text-zinc-200 border border-white/5"
            >
              Tanlash
            </button>
          ) : cartQty > 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-[#1c1d22] p-0.5 border border-white/8">
              <button
                onClick={onDecrease}
                className="tap flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-black font-bold text-xs"
              >
                −
              </button>
              <span className="text-xs font-bold text-white px-1">{cartQty}</span>
              <button
                onClick={onIncrease}
                className="tap flex h-6 w-6 items-center justify-center rounded-md bg-amber-500 text-black font-bold text-xs"
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={onAdd}
              className="tap flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500 text-black font-bold text-sm shadow-sm"
              aria-label="Qo‘shish"
            >
              +
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ProductSheet({
  product,
  onClose,
  onAdded,
}: {
  product: PosProduct | null;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { addToCart } = useApp();
  const [qty, setQty] = useState(1);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");

  const activeProduct = product;
  const groups = useMemo(() => {
    if (!activeProduct) return [] as { name: string; modifiers: PosProduct["modifiers"] }[];
    const map = new Map<string, PosProduct["modifiers"]>();
    for (const modifier of activeProduct.modifiers) {
      const key = modifier.groupName ?? "Qo‘shimchalar";
      map.set(key, [...(map.get(key) ?? []), modifier]);
    }
    return [...map.entries()].map(([name, modifiers]) => ({ name, modifiers }));
  }, [activeProduct]);

  if (!activeProduct) return null;

  const unitPrice =
    activeProduct.price +
    Object.entries(selected).reduce((sum, [id, count]) => {
      const modifier = activeProduct.modifiers.find((item) => item.id === id);
      return sum + (modifier ? modifier.price * count : 0);
    }, 0);

  const total = unitPrice * qty;
  const maxQty = activeProduct.stock !== null ? activeProduct.stock : 50;

  return (
    <Sheet
      open={!!activeProduct}
      onClose={onClose}
      title={activeProduct.name}
      subtitle={activeProduct.description}
      footer={
        <div className="flex items-center gap-3">
          <QtyStepper value={qty} min={1} max={Math.max(1, maxQty)} onChange={(next) => setQty(Math.max(1, next))} />
          <button
            onClick={() => {
              addToCart(
                activeProduct,
                qty,
                Object.entries(selected)
                  .filter(([, count]) => count > 0)
                  .map(([id, count]) => ({ id, qty: count })),
                note.trim() || undefined,
              );
              onAdded();
            }}
            className="tap btn-primary flex-1 py-3 text-[14px] font-bold"
          >
            Qo‘shish · {total.toLocaleString("ru-RU")} so‘m
          </button>
        </div>
      }
    >
      <div className="mb-4 h-[160px] overflow-hidden rounded-xl bg-[#1c1d22]">
        {activeProduct.imageUrl ? (
          <img src={activeProduct.imageUrl} alt={activeProduct.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-5xl">🌭</div>
        )}
      </div>

      <div className="mb-3 flex items-center justify-between">
        <Money value={activeProduct.price} className="text-[17px] font-bold text-amber-400" />
      </div>

      {groups.map((group) => (
        <div key={group.name} className="mb-3">
          <p className="mb-1.5 text-[12px] font-bold text-zinc-400 uppercase tracking-wider">{group.name}</p>
          <div className="space-y-1.5">
            {group.modifiers.map((modifier) => {
              const count = selected[modifier.id] ?? 0;
              return (
                <div key={modifier.id} className="flex items-center justify-between rounded-xl border border-white/5 bg-[#18191d] px-3 py-2">
                  <div className="min-w-0 pr-2">
                    <p className="truncate text-[13px] font-medium text-white">{modifier.name}</p>
                    <p className="text-[11px] text-zinc-400">
                      {modifier.price > 0 ? `+${modifier.price.toLocaleString("ru-RU")} so‘m` : "Bepul"}
                    </p>
                  </div>
                  {count === 0 ? (
                    <button
                      onClick={() => {
                        haptic("light");
                        setSelected((prev) => ({ ...prev, [modifier.id]: 1 }));
                      }}
                      className="tap rounded-lg bg-[#22232a] px-2.5 py-1 text-[11.5px] font-semibold text-zinc-300 border border-white/5"
                    >
                      + Qo‘shish
                    </button>
                  ) : (
                    <QtyStepper
                      size="sm"
                      value={count}
                      max={modifier.maxQty ?? 5}
                      onChange={(next) =>
                        setSelected((prev) => {
                          const copy = { ...prev };
                          if (next <= 0) delete copy[modifier.id];
                          else copy[modifier.id] = next;
                          return copy;
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mb-2">
        <p className="mb-1 text-[12px] font-bold text-zinc-400 uppercase tracking-wider">Izoh</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={200}
          placeholder="Oshxona uchun maxsus istak..."
          className="w-full rounded-xl border border-white/8 bg-[#18191d] p-2.5 text-[13px] text-white placeholder-zinc-500 focus:border-amber-500 focus:outline-none"
        />
      </div>
    </Sheet>
  );
}
