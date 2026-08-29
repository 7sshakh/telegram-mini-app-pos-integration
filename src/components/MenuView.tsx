"use client";
/* eslint-disable @next/next/no-img-element */

import { useMemo, useState } from "react";

import { EmptyState, Icon, Money, QtyStepper, SectionTitle, Sheet, Skeleton, useDebounced } from "@/components/ui";
import { haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import type { PosProduct } from "@/lib/types";

export function MenuView() {
  const { state, addToCart, setTab, refreshMenu } = useApp();
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
      <div className="px-4">
        <Skeleton className="mb-4 h-11 w-full" />
        <Skeleton className="mb-4 h-9 w-full" />
        <div className="mb-4 flex gap-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="mb-3 h-28 w-full" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <EmptyState
        emoji="🍟"
        title="Menyu hozir bo‘sh"
        text="POS kompyuteri offline bo‘lishi mumkin. Aloqa tikolgach menyu avtomatik yangilanadi."
        action={
          <button onClick={() => void refreshMenu()} className="tap btn-ghost px-4 py-2 text-[13px] font-semibold">
            Qayta urinish
          </button>
        }
      />
    );
  }

  return (
    <div className="pb-2">
      <div className="sticky top-0 z-20 -mx-0 bg-gradient-to-b from-ink via-ink/95 to-transparent px-4 pb-3 pt-3 backdrop-blur">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand">VIBE</p>
            <h1 className="text-[19px] font-extrabold leading-tight">HotDog · Burger · Drinks</h1>
          </div>
          <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70">
            <span
              className={`h-2 w-2 rounded-full ${state.catalog?.meta.posOnline ? "bg-mint live-dot" : "bg-flame"}`}
            />
            {state.catalog?.meta.posOnline ? "POS online" : "POS offline"}
          </div>
        </div>

        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Taom izlash: hotdog, burger, cola…"
            className="!pl-9"
            style={{ paddingLeft: "2.25rem" }}
          />
        </div>

        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          <CategoryChip active={category === "all"} onClick={() => setCategory("all")} label="Barchasi" emoji="✨" />
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

      {!debouncedQuery && category === "all" && popular.length > 0 ? (
        <section className="mb-5 px-4">
          <SectionTitle>Ommabop tanlovlar</SectionTitle>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {popular.map((product) => (
              <button
                key={product.id}
                onClick={() => setActiveProduct(product)}
                className="tap card w-[168px] shrink-0 overflow-hidden text-left"
              >
                <div className="h-[104px] w-full overflow-hidden bg-ink-card">
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-3xl">🌭</div>
                  )}
                </div>
                <div className="p-3">
                  <p className="line-clamp-1 text-[13.5px] font-semibold">{product.name}</p>
                  <Money value={product.price} className="mt-1 block text-[13px] font-bold text-brand" />
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="px-4">
        <SectionTitle right={<span className="text-[11.5px] text-muted">{filtered.length} ta taom</span>}>
          {category === "all" ? "Menyu" : categories.find((item) => item.id === category)?.name ?? "Menyu"}
        </SectionTitle>

        {filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="Hech narsa topilmadi" text="Boshqa so‘z bilan qidirib ko‘ring yoki kategoriyani o‘zgartiring." />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((product) => (
              <ProductRow key={product.id} product={product} onOpen={() => setActiveProduct(product)} onQuickAdd={() => {
                addToCart(product, 1, []);
              }} />
            ))}
          </div>
        )}
      </section>

      <ProductSheet product={activeProduct} onClose={() => setActiveProduct(null)} onAdded={() => {
        setActiveProduct(null);
        setTab("cart");
      }} />
    </div>
  );
}

function CategoryChip({ label, emoji, active, onClick }: { label: string; emoji?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`tap chip shrink-0 px-3.5 py-2 text-[12.5px] font-semibold ${active ? "chip-active" : "text-white/70"}`}
    >
      {emoji ? <span className="mr-1">{emoji}</span> : null}
      {label}
    </button>
  );
}

function ProductRow({ product, onOpen, onQuickAdd }: { product: PosProduct; onOpen: () => void; onQuickAdd: () => void }) {
  const lowStock = product.stock !== null && product.stock <= 5;
  return (
    <div className="card rise flex items-stretch gap-3 overflow-hidden p-2.5">
      <button onClick={onOpen} className="tap h-[92px] w-[92px] shrink-0 overflow-hidden rounded-xl bg-ink-card">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl">🍔</div>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <button onClick={onOpen} className="text-left">
          <div className="flex items-center gap-1.5">
            <p className="line-clamp-1 text-[14.5px] font-bold">{product.name}</p>
            {product.tags?.includes("spicy") ? <span className="text-[12px]">🌶️</span> : null}
          </div>
          {product.description ? <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{product.description}</p> : null}
        </button>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            {product.oldPrice ? (
              <span className="mr-1.5 text-[11px] text-muted line-through">{product.oldPrice.toLocaleString("ru-RU")}</span>
            ) : null}
            <Money value={product.price} className="text-[14px] font-extrabold text-brand" />
            {lowStock ? (
              <p className="mt-0.5 text-[10.5px] text-flame">Faqat {product.stock} ta qoldi</p>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            {product.modifiers.length > 0 ? (
              <button onClick={onOpen} className="tap rounded-xl border border-white/12 bg-white/5 px-2.5 py-2 text-[11px] font-semibold text-white/80">
                Tanlash
              </button>
            ) : null}
            <button
              onClick={onQuickAdd}
              className="tap btn-primary flex h-9 w-9 items-center justify-center rounded-xl"
              aria-label="Savatchaga qo‘shish"
            >
              <Icon name="plus" className="h-4 w-4" />
            </button>
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
            className="tap btn-primary flex-1 py-3 text-[15px]"
          >
            Qo‘shish · {total.toLocaleString("ru-RU")} so‘m
          </button>
        </div>
      }
    >
      <div className="mb-4 h-[180px] overflow-hidden rounded-2xl bg-ink-card">
        {activeProduct.imageUrl ? (
          <img src={activeProduct.imageUrl} alt={activeProduct.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-6xl">🌭</div>
        )}
      </div>

      <div className="mb-4 flex items-center gap-2">
        <Money value={activeProduct.price} className="text-[18px] font-extrabold text-brand" />
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
                    <p className="truncate text-[13.5px] font-medium">{modifier.name}</p>
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
                      className="tap rounded-lg border border-white/15 bg-white/6 px-3 py-1.5 text-[12px] font-semibold"
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
        <p className="mb-2 text-[13px] font-bold">Izoh (ixtiyoriy)</p>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          maxLength={240}
          placeholder="Masalan: sousni ko‘proq qiling"
        />
      </div>
    </Sheet>
  );
}
