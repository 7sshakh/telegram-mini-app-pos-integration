"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button, EmptyState, Icon, Money, SectionTitle, Spinner, StatusBadge } from "@/components/ui";
import { api, ApiError, getToken } from "@/lib/client/api";
import { confirmInTelegram, haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { formatDateTime } from "@/lib/format";
import { ORDER_TYPE_LABELS, PAYMENT_LABELS, POS_SYNC_LABELS, STATUS_FLOW, STATUS_LABELS } from "@/lib/uz";
import type { OrderDTO } from "@/lib/types";

export function OrdersView() {
  const { state, repeatOrder, toast, refreshProfile } = useApp();
  const [orders, setOrders] = useState<OrderDTO[] | null>(null);
  const [loading, setLoading] = useState(true);
  const activeId = state.activeOrderId;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api<{ orders: OrderDTO[] }>("/api/orders");
      setOrders(response.orders);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Buyurtmalar yuklanmadi.", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!activeId) void load();
  }, [activeId, load]);

  useEffect(() => {
    if (activeId) void refreshProfile();
  }, [activeId, refreshProfile]);

  if (activeId) {
    const active = orders?.find((order) => order.id === activeId) ?? state.lastOrder;
    if (active && active.id === activeId) return <OrderTracker order={active} onChanged={setOrders} />;
    return <TrackerLoader id={activeId} />;
  }

  if (loading) {
    return (
      <div className="px-4">
        <SectionTitle>Buyurtmalarim</SectionTitle>
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton mb-3 h-28 w-full" />
        ))}
      </div>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <EmptyState
        emoji="🧾"
        title="Buyurtmalar tarixi bo‘sh"
        text="Birinchi buyurtmangizni berganingizda bu yerda holatni real vaqtda kuzatib borasiz."
      />
    );
  }

  return (
    <div className="px-4">
      <SectionTitle right={<span className="text-[11.5px] text-muted">{orders.length} ta</span>}>Buyurtmalarim</SectionTitle>
      <div className="space-y-2.5">
        {orders.map((order) => (
          <div key={order.id} className="card rise p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[14px] font-extrabold">Buyurtma {order.orderNumber}</p>
                <p className="mt-0.5 text-[11.5px] text-muted">
                  {formatDateTime(order.createdAt)} · {ORDER_TYPE_LABELS[order.orderType]}
                </p>
              </div>
              <StatusBadge status={order.status} label={order.statusLabel} />
            </div>

            <div className="mt-3 space-y-1">
              {order.items.slice(0, 3).map((item) => (
                <p key={`${item.productId}-${item.modifiers.map((m) => m.id).join()}`} className="text-[12px] text-white/80">
                  <b>{item.qty}×</b> {item.name}
                  {item.modifiers.length ? <span className="text-muted"> · {item.modifiers.map((m) => m.name).join(", ")}</span> : null}
                </p>
              ))}
              {order.items.length > 3 ? <p className="text-[11.5px] text-muted">+{order.items.length - 3} ta yana</p> : null}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
              <div>
                <Money value={order.totals.total} className="text-[15px] font-extrabold text-brand" />
                <p className="text-[11px] text-muted">{PAYMENT_LABELS[order.payment.method] ?? order.payment.method}</p>
              </div>
              <button onClick={() => repeatOrder(order)} className="tap btn-ghost px-3.5 py-2 text-[12px] font-semibold">
                Takrorlash
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrackerLoader({ id }: { id: string }) {
  const [order, setOrder] = useState<OrderDTO | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const response = await api<{ order: OrderDTO }>(`/api/orders/${id}`);
        setOrder(response.order);
      } catch {
        setOrder(null);
      }
    })();
  }, [id]);
  if (!order) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-16 text-[13px] text-muted">
        <Spinner /> Buyurtma yuklanmoqda…
      </div>
    );
  }
  return <OrderTracker order={order} onChanged={() => undefined} />;
}

function OrderTracker({ order, onChanged }: { order: OrderDTO; onChanged: (orders: OrderDTO[]) => void }) {
  const { toast } = useApp();
  const [current, setCurrent] = useState<OrderDTO>(order);
  const [live, setLive] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setCurrent(order);
  }, [order]);

  // live updates over SSE, automatic polling fallback
  useEffect(() => {
    const token = getToken();
    if (!token) return;

    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const response = await api<{ order: OrderDTO }>(`/api/orders/${order.id}`, { retries: 1, timeoutMs: 8000 });
          setCurrent(response.order);
          onChanged([response.order]);
        } catch {
          // keep the last known state on bad networks
        }
      }, 6000);
    };

    try {
      const source = new EventSource(`/api/orders/${order.id}/stream?token=${encodeURIComponent(token)}`);
      sourceRef.current = source;
      source.addEventListener("open", () => setLive(true));
      source.addEventListener("order", (event) => {
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { order: OrderDTO };
          setCurrent(data.order);
          onChanged([data.order]);
          haptic("light");
        } catch {
          // ignore malformed frame
        }
      });
      source.addEventListener("ping", () => setLive(true));
      source.addEventListener("bye", () => source.close());
      source.addEventListener("error", () => {
        setLive(false);
        source.close();
        startPolling();
      });
    } catch {
      startPolling();
    }

    return () => {
      sourceRef.current?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [onChanged, order.id]);

  const currentIndex = STATUS_FLOW.indexOf(current.status);
  const cancelled = current.status === "cancelled";

  const cancel = async () => {
    const confirmed = await confirmInTelegram("Buyurtmani bekor qilasizmi?");
    if (!confirmed) return;
    setCancelling(true);
    try {
      const response = await api<{ order: OrderDTO }>(`/api/orders/${current.id}`, { method: "DELETE" });
      setCurrent(response.order);
      toast("Buyurtma bekor qilindi.", "ok");
    } catch (error) {
      toast(error instanceof ApiError ? error.message : "Bekor qilishda xatolik.", "error");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="px-4">
      <div className="card mb-4 overflow-hidden">
        <div className="bg-gradient-to-br from-brand/20 to-transparent p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">Buyurtma</p>
              <h2 className="text-[22px] font-extrabold leading-tight">{current.orderNumber}</h2>
              <p className="mt-1 text-[12px] text-muted">
                {formatDateTime(current.createdAt)} · {ORDER_TYPE_LABELS[current.orderType]}
              </p>
            </div>
            <div className="text-right">
              <StatusBadge status={current.status} label={current.statusLabel} />
              <p className="mt-2 flex items-center justify-end gap-1 text-[10.5px] text-muted">
                {live ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-mint live-dot" /> jonli
                  </>
                ) : (
                  "yangilanmoqda"
                )}
              </p>
            </div>
          </div>

          {current.posSyncStatus === "failed" ? (
            <p className="mt-3 rounded-xl border border-flame/40 bg-flame/10 p-2.5 text-[11.5px] leading-snug text-white">
              Buyurtmani yuborishda xatolik yuz berdi. Iltimos aloqaga chiqing.
            </p>
          ) : null}
        </div>

        <div className="p-4">
          <div className="space-y-0">
            {STATUS_FLOW.map((status, index) => {
              const done = !cancelled && index < currentIndex;
              const active = !cancelled && index === currentIndex;
              const event = current.timeline.find((item) => item.status === status);
              return (
                <div key={status} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                        active
                          ? "border-brand bg-brand text-black"
                          : done
                            ? "border-mint/50 bg-mint/20 text-mint"
                            : "border-white/12 bg-white/5 text-white/30"
                      } ${active ? "live-dot" : ""}`}
                    >
                      {done ? <Icon name="check" className="h-3.5 w-3.5" /> : active ? "●" : index + 1}
                    </div>
                    {index < STATUS_FLOW.length - 1 ? (
                      <div className={`h-8 w-[2px] ${done ? "bg-mint/40" : "bg-white/10"}`} />
                    ) : null}
                  </div>
                  <div className="pb-1 pt-1">
                    <p className={`text-[13px] font-semibold ${active ? "text-brand" : done ? "text-white/85" : "text-white/40"}`}>
                      {STATUS_LABELS[status]}
                      {status === "delivered" || status === "completed" ? null : ""}
                    </p>
                    {event ? <p className="text-[11px] text-muted">{formatDateTime(event.at)}</p> : null}
                  </div>
                </div>
              );
            })}
          </div>

          {cancelled ? (
            <div className="mt-2 rounded-xl border border-flame/40 bg-flame/10 p-3 text-[12.5px] text-white">
              Buyurtma bekor qilindi{current.timeline.find((item) => item.status === "cancelled")?.note ? `: ${current.timeline.find((item) => item.status === "cancelled")?.note}` : ""}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card mb-4 p-4">
        <p className="mb-3 text-[13px] font-bold">Tarkib</p>
        <div className="space-y-2">
          {current.items.map((item) => (
            <div key={`${item.productId}-${item.modifiers.map((m) => m.id).join()}`} className="flex justify-between gap-3 text-[12.5px]">
              <span className="min-w-0">
                <b>{item.qty}×</b> {item.name}
                {item.modifiers.length ? (
                  <span className="block text-[11px] text-muted">{item.modifiers.map((m) => m.name).join(", ")}</span>
                ) : null}
              </span>
              <span className="shrink-0 font-semibold">{item.lineTotal.toLocaleString("ru-RU")}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 border-t border-white/8 pt-3 text-[12px]">
          <div className="flex justify-between text-muted">
            <span>Mahsulotlar</span>
            <span>{current.totals.itemsTotal.toLocaleString("ru-RU")}</span>
          </div>
          {current.totals.promoDiscount ? (
            <div className="flex justify-between text-mint">
              <span>Aksiya ({current.promo?.title ?? "chegirma"})</span>
              <span>−{current.totals.promoDiscount.toLocaleString("ru-RU")}</span>
            </div>
          ) : null}
          {current.totals.deliveryFee ? (
            <div className="flex justify-between text-muted">
              <span>Yetkazib berish</span>
              <span>{current.totals.deliveryFee.toLocaleString("ru-RU")}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-[15px] font-extrabold text-brand">
            <span>Jami</span>
            <span>{current.totals.total.toLocaleString("ru-RU")} so‘m</span>
          </div>
        </div>
      </div>

      <div className="card mb-4 space-y-1.5 p-4 text-[12.5px]">
        <p className="mb-1 text-[13px] font-bold">To‘lov va manzil</p>
        <div className="flex justify-between">
          <span className="text-muted">To‘lov</span>
          <span className="font-semibold">{PAYMENT_LABELS[current.payment.method] ?? current.payment.method}</span>
        </div>
        {current.payment.change ? (
          <div className="flex justify-between">
            <span className="text-muted">Qaytim</span>
            <span className="font-semibold">{current.payment.change.toLocaleString("ru-RU")} so‘m</span>
          </div>
        ) : null}
        {current.address ? (
          <div className="pt-1">
            <p className="text-muted">Manzil</p>
            <p className="font-semibold">{current.address.addressLine}</p>
            <p className="text-[11.5px] text-muted">
              {[
                current.address.apartment ? `Kv. ${current.address.apartment}` : null,
                current.address.entrance ? `Podyezd ${current.address.entrance}` : null,
                current.address.floor ? `${current.address.floor}-qavat` : null,
                current.address.landmark,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        ) : null}
        {current.customerNote ? (
          <p className="pt-1 text-[11.5px] italic text-muted">Izoh: {current.customerNote}</p>
        ) : null}
      </div>

      {["new", "accepted"].includes(current.status) ? (
        <Button variant="danger" className="w-full" loading={cancelling} onClick={() => void cancel()}>
          Buyurtmani bekor qilish
        </Button>
      ) : null}
    </div>
  );
}
