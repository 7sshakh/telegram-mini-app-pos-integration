"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";

import { EmptyState, Icon, Money, QtyStepper, SectionTitle, Sheet, Skeleton, useDebounced } from "@/components/ui";
import { haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import type { PosProduct } from "@/lib/types";

export function MenuView() {
  const { state, addToCart, changeQty, removeFromCart, setTab, refreshMenu } = useApp();
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

  const popular = useMemo(
    () => products.filter((product) => product.isAvailable && (product.tags?.includes("popular") ?? false)).slice(0, 6),
    [products],
  );

  if (state.catalogLoading) {
    return (
      <div className="px-4 pt-3">
        <Skeleton className="mb-4 h-12 w-full rounded-2xl" />
        <Skeleton className="mb-4 h-10 w-full rounded-xl" />
        <div className="mb-4 flex gap-2 overflow-x-hidden">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-9 w-28 shrink-0 rounded-full" />
          ))}
        </div>
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="mb-3 h-28 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <EmptyState
        emoji="🍟"
        title="Menyu yuklanmoqda"
        text="Aloqa o‘rnatilmoqda, iltimos bir necha soniya kuting..."
        action={
          <button onClick={() => void refreshMenu()} className="tap btn-primary px-5 py-2.5 text-[13px] font-bold">
            Qayta yuklash
          </button>
        }
      />
    );
  }

  return (
    <div className="pb-24">
      {/* Top Header with Telegram safe-area */}
      <div className="sticky top-0 z-20 bg-ink/95 px-4 pb-3 pt-3 backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-amber-500 text-base font-black text-black shadow-lg shadow-brand/20">
              V
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-black tracking-tight text-white">VIBE</span>
                <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-extrabold text-brand">FOODS</span>
              </div>
              <p className="text-[11px] font-medium text-white/50">HotDog · Burger · Drinks</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/80">
            <span className="h-2 w-2 rounded-full bg-mint live-dot" />
            Ochiq
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Icon name="search" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Taom yoki ichimlik izlash..."
            className="w-full rounded-2xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-[13.5px] text-white placeholder-white/40 focus:border-brand focus:outline-none"
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-white/40"
            >
              ✕
            </button>
          ) : null}
        </div>

        {/* Categories Bar */}
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
          <CategoryChip
            active={category === "all"}
            onClick={() => setCategory("all")}
            label="Barchasi"
            emoji="✨"
          />
          {categories.map((item) => (
            <CategoryChip
              key={item.id}
              active={category === item.id}
              onClick={() => {
                haptic("light");
                setCategory(item.id);
              }}
              label={item.name}
              emoji={item.emoji}
            />
          ))}
        </div>
      </div>

      {/* Popular Selection */}
      {!debouncedQuery && category === "all" && popular.length > 0 ? (
        <section className="mb-5 mt-2 px-4">
          <SectionTitle>Ommabop tanlovlar</SectionTitle>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {popular.map((product) => (
              <button
                key={product.id}
                onClick={() => setActiveProduct(product)}
                className="tap card w-[156px] shrink-0 overflow-hidden text-left border border-white/8 bg-ink-soft/60"
              >
                <div className="h-[108px] w-full overflow-hidden bg-white/4">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-4xl">🌭</div>
                  )}
                </div>
                <div className="p-2.5">
                  <p className="line-clamp-1 text-[13px] font-bold">{product.name}</p>
                  <Money value={product.price} className="mt-1 block text-[13px] font-extrabold text-brand" />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* Main Menu List */}
      <section className="mt-2 px-4">
        <SectionTitle right={<span className="text-[11.5px] font-medium text-white/50">{filtered.length} ta taom</span>}>
          {category === "all" ? "Menyu" : categories.find((item) => item.id === category)?.name ?? "Menyu"}
        </SectionTitle>

        {filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="Hech narsa topilmadi" text="Boshqa so‘z bilan qidirib ko‘ring yoki kategoriyani o‘zgartiring." />
        ) : (
          <div className="space-y-3">
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
                  onIncrease={() => cartItem && changeQty(cartItem.key, cartItem.qty + 1)}
                  onDecrease={() => {
                    if (!cartItem) return;
                    if (cartItem.qty <= 1) removeFromCart(cartItem.key);
                    else changeQty(cartItem.key, cartItem.qty - 1);
                  }}
                />
              );
            })}
          </div>
        )}
      </section>

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

function CategoryChip({ label, emoji, active, onClick }: { label: string; emoji?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap shrink-0 rounded-2xl px-4 py-2 text-[12.5px] font-bold transition-all ${
        active
          ? "bg-gradient-to-r from-brand to-amber-500 text-black shadow-lg shadow-brand/20"
          : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      {emoji ? <span className="mr-1.5">{emoji}</span> : null}
      {label}
    </button>
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
  const lowStock = product.stock !== null && product.stock <= 5;
  const hasModifiers = product.modifiers.length > 0;

  return (
    <div className="card rise flex items-stretch gap-3 overflow-hidden border border-white/8 bg-ink-soft/80 p-3">
      {/* Product Image */}
      <button
        onClick={onOpen}
        className="tap relative h-[94px] w-[94px] shrink-0 overflow-hidden rounded-2xl bg-white/4"
      >
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl">🍔</div>
        )}
      </button>

      {/* Product Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <button onClick={onOpen} className="text-left">
          <div className="flex items-center gap-1.5">
            <p className="line-clamp-1 text-[15px] font-bold text-white">{product.name}</p>
            {product.tags?.includes("spicy") ? <span className="text-[12px]">🌶️</span> : null}
          </div>
          {product.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-white/60">{product.description}</p>
          ) : null}
        </button>

        {/* Price and Add/Qty Controls */}
        <div className="mt-2.5 flex items-end justify-between gap-2">
          <div>
            {product.oldPrice ? (
              <span className="mr-1.5 text-[11px] text-white/40 line-through">
                {product.oldPrice.toLocaleString("ru-RU")}
              </span>
            ) : null}
            <Money value={product.price} className="text-[15px] font-black text-brand" />
            {lowStock ? (
              <p className="mt-0.5 text-[10.5px] font-medium text-flame">Faqat {product.stock} ta qoldi</p>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {hasModifiers ? (
              <button
                onClick={onOpen}
                className="tap flex items-center gap-1 rounded-xl bg-gradient-to-r from-brand to-amber-500 px-3 py-1.5 text-[12px] font-bold text-black shadow-md shadow-brand/20"
              >
                Tanlash
              </button>
            ) : cartQty > 0 ? (
              <div className="flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 p-1">
                <button
                  onClick={onDecrease}
                  className="tap flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-black font-black text-sm"
                >
                  −
                </button>
                <span className="text-xs font-black text-white px-1">{cartQty}</span>
                <button
                  onClick={onIncrease}
                  className="tap flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-black font-black text-sm"
                >
                  +
                </button>
              </div>
            ) : (
              <button
                onClick={onAdd}
                className="tap flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-r from-brand to-amber-500 text-black shadow-md shadow-brand/20 font-black text-base"
                aria-label="Qo‘shish"
              >
                +
              </button>
            )}
          </div>
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
            className="tap btn-primary flex-1 py-3 text-[15px] font-extrabold"
          >
            Qo‘shish · {total.toLocaleString("ru-RU")} so‘m
          </button>
        </div>
      }
    >
      <div className="mb-4 h-[180px] overflow-hidden rounded-2xl bg-white/4">
        {activeProduct.imageUrl ? (
          <img src={activeProduct.imageUrl} alt={activeProduct.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-6xl">🌭</div>
        )}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Money value={activeProduct.price} className="text-[18px] font-black text-brand" />
        {activeProduct.stock !== null ? (
          <span className={`rounded-full border px-2 py-0.5 text-[10.5px] ${activeProduct.stock > 5 ? "border-mint/30 text-mint" : "border-flame/40 text-flame"}`}>
            {activeProduct.stock > 0 ? `Omborda: ${activeProduct.stock}` : "Tugagan"}
          </span>
        ) : null}
      </div>

      {groups.map((group) => (
        <div key={group.name} className="mb-4">
          <p className="mb-2 text-[13px] font-bold text-white/90">{group.name}</p>
          <div className="space-y-2">
            {group.modifiers.map((modifier) => {
              const count = selected[modifier.id] ?? 0;
              return (
                <div key={modifier.id} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/4 px-3 py-2.5">
                  <div className="min-w-0 pr-2">
                    <p className="truncate text-[13.5px] font-medium text-white">{modifier.name}</p>
                    <p className="text-[11.5px] text-muted">
                      {modifier.price > 0 ? `+${modifier.price.toLocaleString("ru-RU")} so‘m` : "Bepul"}
                    </p>
                  </div>
                  {count === 0 ? (
                    <button
                      onClick={() => {
                        haptic("light");
                        setSelected((prev) => ({ ...prev, [modifier.id]: 1 }));
                      }}
                      className="tap rounded-lg border border-white/15 bg-white/6 px-3 py-1.5 text-[12px] font-semibold text-white"
                    >
                      Qo‘shish
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
        <p className="mb-2 text-[13px] font-bold text-white/90">Izoh (ixtiyoriy)</p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={240}
          placeholder="Masalan: sousni ko‘proq qiling"
          className="w-full rounded-xl border border-white/10 bg-white/5 p-2.5 text-sm text-white placeholder-white/40 focus:border-brand focus:outline-none"
        />
      </div>
    </Sheet>
  );
}
