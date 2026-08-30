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
  { id: "orders", label: "Buyurtmalar", icon: "receipt" },
  { id: "profile", label: "Profil", icon: "user" },
];

export function MiniApp() {
  const { state, cartCount, estimate, setTab, devLogin } = useApp();

  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    try {
      webApp?.enableClosingConfirmation?.();
      webApp?.expand?.();
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
            <div className="skeleton h-12 w-12 rounded-2xl" />
            <div className="flex-1">
              <div className="skeleton mb-2 h-4 w-40 rounded-lg" />
              <div className="skeleton h-3 w-24 rounded-lg" />
            </div>
          </div>
          <div className="skeleton mb-4 h-11 w-full rounded-2xl" />
          <div className="skeleton mb-6 h-36 w-full rounded-2xl" />
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton mb-3 h-28 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen bg-[#07070b] text-white">
      <Toaster />
      <ConnectionBanner />

      <main className="min-h-[calc(100vh-80px)]">
        {state.tab === "menu" ? <MenuView /> : null}
        {state.tab === "cart" ? <CartView /> : null}
        {state.tab === "orders" ? <OrdersView /> : null}
        {state.tab === "profile" ? <ProfileView /> : null}
      </main>

      {/* Floating Bottom Cart Bar when browsing Menu or other tabs */}
      {state.tab !== "cart" && cartCount > 0 && estimate ? (
        <div className="fixed inset-x-0 bottom-[68px] z-30 px-4 pointer-events-none">
          <button
            onClick={() => setTab("cart")}
            className="tap pointer-events-auto mx-auto flex w-full max-w-[500px] items-center justify-between rounded-2xl bg-gradient-to-r from-brand via-amber-400 to-brand-deep p-3.5 text-[14px] font-black text-black shadow-2xl shadow-brand/30 animate-bounce-short"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-black text-xs font-black text-brand">
                {cartCount}
              </span>
              <span className="font-extrabold">{formatSum(estimate.total)} so‘m</span>
            </div>
            <div className="flex items-center gap-1.5 font-black text-xs uppercase tracking-wider bg-black/10 px-3 py-1.5 rounded-xl">
              Savatga o‘tish ➔
            </div>
          </button>
        </div>
      ) : null}

      {/* Bottom Navigation Bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0c0c14]/95 backdrop-blur-2xl"
        style={{ paddingBottom: "var(--safe-bottom, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-[520px] items-stretch">
          {TABS.map((tab) => {
            const active = state.tab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`tap relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-bold transition-all ${
                  active ? "text-brand" : "text-white/40 hover:text-white/70"
                }`}
              >
                <span className="relative">
                  <Icon name={tab.icon} className={`h-5 w-5 ${active ? "scale-110" : ""}`} />
                  {tab.id === "cart" && cartCount > 0 ? (
                    <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-flame px-1 text-[9px] font-black text-white">
                      {cartCount}
                    </span>
                  ) : null}
                </span>
                <span>{tab.label}</span>
                {active ? <span className="absolute top-0 h-[3px] w-8 rounded-full bg-brand shadow-sm shadow-brand" /> : null}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
