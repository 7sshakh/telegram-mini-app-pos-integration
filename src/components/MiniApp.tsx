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
  const { state, cartCount, estimate, setTab } = useApp();

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
      <div className="app-shell p-4 space-y-3">
        <Toaster />
        <div className="skeleton h-10 w-full rounded-xl" />
        <div className="skeleton h-28 w-full rounded-xl" />
        <div className="skeleton h-28 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen bg-[#0c0d0e] text-white">
      <Toaster />
      <ConnectionBanner />

      <main className="min-h-[calc(100vh-70px)]">
        {state.tab === "menu" ? <MenuView /> : null}
        {state.tab === "cart" ? <CartView /> : null}
        {state.tab === "orders" ? <OrdersView /> : null}
        {state.tab === "profile" ? <ProfileView /> : null}
      </main>

      {/* Clean Floating Cart Bar */}
      {state.tab !== "cart" && cartCount > 0 && estimate ? (
        <div className="fixed inset-x-0 bottom-[64px] z-30 px-4 pointer-events-none">
          <button
            onClick={() => setTab("cart")}
            className="tap pointer-events-auto mx-auto flex w-full max-w-lg items-center justify-between rounded-xl bg-amber-500 p-3 text-[13.5px] font-bold text-black shadow-lg"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-black text-[11px] font-bold text-amber-400">
                {cartCount}
              </span>
              <span>{formatSum(estimate.total)} so‘m</span>
            </div>
            <div className="flex items-center gap-1 font-bold text-xs uppercase tracking-wider">
              Savat ➔
            </div>
          </button>
        </div>
      ) : null}

      {/* Minimal Bottom Nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/5 bg-[#0c0d0e]/95 backdrop-blur-md"
        style={{ paddingBottom: "var(--safe-bottom, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mx-auto flex max-w-lg items-stretch">
          {TABS.map((tab) => {
            const active = state.tab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTab(tab.id)}
                className={`tap relative flex flex-1 flex-col items-center gap-1 py-2 text-[10.5px] font-medium transition-colors ${
                  active ? "text-amber-400 font-bold" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <span className="relative">
                  <Icon name={tab.icon} className="h-5 w-5" />
                  {tab.id === "cart" && cartCount > 0 ? (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                      {cartCount}
                    </span>
                  ) : null}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
