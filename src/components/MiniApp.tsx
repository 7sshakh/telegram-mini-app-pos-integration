"use client";

import { useEffect } from "react";

import { CartView } from "@/components/CartView";
import { MenuView } from "@/components/MenuView";
import { OrdersView } from "@/components/OrdersView";
import { ProfileView } from "@/components/ProfileView";
import { Button, ConnectionBanner, Icon, Toaster } from "@/components/ui";
import { useApp, type Tab } from "@/lib/client/store";
import { formatSum } from "@/lib/format";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "menu", label: "Menyu", icon: "menu" },
  { id: "cart", label: "Savat", icon: "cart" },
  { id: "orders", label: "Buyurtma", icon: "receipt" },
  { id: "profile", label: "Profil", icon: "user" },
];

export function MiniApp() {
  const { state, cartCount, estimate, setTab, devLogin } = useApp();

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    try {
      webApp?.enableClosingConfirmation?.();
    } catch {
      // older clients
    }
  }, []);

  if (state.boot === "loading") {
    return (
      <div className="app-shell">
        <Toaster />
        <div className="px-4 pt-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="skeleton h-12 w-12 rounded-full" />
            <div className="flex-1">
              <div className="skeleton mb-2 h-4 w-40" />
              <div className="skeleton h-3 w-24" />
            </div>
          </div>
          <div className="skeleton mb-4 h-11 w-full" />
          <div className="skeleton mb-6 h-36 w-full" />
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton mb-3 h-28 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (state.boot === "error") {
    return (
      <div className="app-shell flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
        <Toaster />
        <div className="text-5xl">🔌</div>
        <h2 className="mt-4 text-[17px] font-bold">Kirishda xatolik</h2>
        <p className="mt-2 max-w-[300px] text-[13px] leading-relaxed text-muted">{state.bootError}</p>
        <Button className="mt-5 px-6" onClick={() => window.location.reload()}>
          Qayta urinish
        </Button>
        {state.devLoginAvailable ? (
          <button onClick={() => void devLogin()} className="tap mt-3 text-[12px] font-semibold text-brand">
            Demo rejimda kirish
          </button>
        ) : null}
      </div>
    );
  }

  if (!state.customer) {
    return (
      <div className="app-shell flex min-h-[70dvh] flex-col items-center justify-center px-6 text-center">
        <Toaster />
        <div className="text-5xl">🌭</div>
        <h2 className="mt-4 text-[18px] font-extrabold">VIBE</h2>
        <p className="mt-1 text-[13px] text-muted">HotDog · Burger · Drinks</p>
        <p className="mt-4 max-w-[300px] text-[13px] leading-relaxed text-muted">
          Buyurtma berish uchun Telegram akkauntingiz bilan kiring. Parol kerak emas.
        </p>
        <Button className="mt-5 px-6" onClick={() => window.location.reload()}>
          Telegram orqali kirish
        </Button>
        {state.devLoginAvailable ? (
          <button onClick={() => void devLogin()} className="tap mt-3 text-[12px] font-semibold text-brand">
            Demo rejimda kirish
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toaster />
      <ConnectionBanner />

      <main className="pt-1">
        {state.tab === "menu" ? <MenuView /> : null}
        {state.tab === "cart" ? <CartView /> : null}
        {state.tab === "orders" ? <OrdersView /> : null}
        {state.tab === "profile" ? <ProfileView /> : null}
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/8 bg-ink-soft/95 backdrop-blur-xl"
        style={{ paddingBottom: "var(--safe-bottom)" }}
      >
        <div className="mx-auto flex max-w-[520px] items-stretch">
          {TABS.map((tab) => {
            const active = state.tab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`tap relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-semibold ${
                  active ? "text-brand" : "text-white/50"
                }`}
              >
                <span className="relative">
                  <Icon name={tab.icon} className="h-5 w-5" />
                  {tab.id === "cart" && cartCount > 0 ? (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-flame px-1 text-[9px] font-bold text-white">
                      {cartCount}
                    </span>
                  ) : null}
                </span>
                {tab.label}
                {active ? <span className="absolute top-0 h-[2px] w-8 rounded-full bg-brand" /> : null}
              </button>
            );
          })}
        </div>
        {state.tab !== "cart" && cartCount > 0 && estimate ? (
          <button
            onClick={() => setTab("cart")}
            className="tap mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-[480px] items-center justify-between rounded-2xl bg-gradient-to-r from-brand to-brand-deep px-4 py-2.5 text-[13px] font-bold text-black"
          >
            <span>
              {cartCount} ta mahsulot · {formatSum(estimate.total)} so‘m
            </span>
            <span className="flex items-center gap-1">
              Savat <Icon name="chevron" className="h-3.5 w-3.5" />
            </span>
          </button>
        ) : null}
      </nav>
    </div>
  );
}
