"use client";

import { useEffect } from "react";

import { CartView } from "@/components/CartView";
import { MenuView } from "@/components/MenuView";
import { OrdersView } from "@/components/OrdersView";
import { ProfileView } from "@/components/ProfileView";
import { ConnectionBanner, Icon, Toaster } from "@/components/ui";
import { useApp, type Tab } from "@/lib/client/store";
import { formatSum } from "@/lib/format";
import { getWebApp } from "@/lib/client/telegram";

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "menu", label: "Menyu", icon: "menu" },
  { id: "cart", label: "Savat", icon: "cart" },
  { id: "orders", label: "Buyurtmalar", icon: "receipt" },
  { id: "profile", label: "Profil", icon: "user" },
];

// Support: 8525601965
const SUPPORT_USERNAME = ""; // Will open Telegram chat with support

export function MiniApp() {
  const { state, cartCount, estimate, setTab } = useApp();

  useEffect(() => {
    const webApp = getWebApp();
    try {
      webApp?.enableClosingConfirmation?.();
      webApp?.expand?.();
      webApp?.setHeaderColor?.("#0a0a0b");
      webApp?.setBackgroundColor?.("#0a0a0b");
    } catch {
      // older clients
    }
  }, []);

  if (state.boot === "loading") {
    return (
      <div className="app-shell p-4 space-y-2.5">
        <Toaster />
        <div className="skeleton h-9 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-44 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen bg-[#0a0a0b] text-white">
      <Toaster />
      <ConnectionBanner />

      <main className="min-h-[calc(100vh-66px)]">
        {state.tab === "menu" ? <MenuView /> : null}
        {state.tab === "cart" ? <CartView /> : null}
        {state.tab === "orders" ? <OrdersView /> : null}
        {state.tab === "profile" ? <ProfileView /> : null}
      </main>

      {/* Floating Cart Bar */}
      {state.tab !== "cart" && cartCount > 0 && estimate ? (
        <div className="fixed inset-x-0 bottom-[58px] z-30 px-3 pointer-events-none">
          <button onClick={() => setTab("cart")}
            className="tap pointer-events-auto mx-auto flex w-full max-w-lg items-center justify-between rounded-xl bg-amber-500 px-3 py-2.5 text-[12.5px] font-bold text-black shadow-lg">
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-black text-[10px] font-bold text-amber-400">{cartCount}</span>
              <span>{formatSum(estimate.total)} so'm</span>
            </div>
            <span className="text-[10.5px] font-bold uppercase tracking-wider">Savat ➔</span>
          </button>
        </div>
      ) : null}

      {/* Bottom Nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/4 bg-[#0a0a0b]/95 backdrop-blur-md"
        style={{ paddingBottom: "var(--safe-bottom, env(safe-area-inset-bottom, 0px))" }}>
        <div className="mx-auto flex max-w-lg items-stretch">
          {TABS.map((tab) => {
            const active = state.tab === tab.id;
            return (
              <button key={tab.id} onClick={() => setTab(tab.id)}
                className={`tap relative flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10px] font-medium ${
                  active ? "text-amber-400 font-bold" : "text-zinc-600"
                }`}>
                <span className="relative">
                  <Icon name={tab.icon} className="h-4.5 w-4.5" />
                  {tab.id === "cart" && cartCount > 0 ? (
                    <span className="absolute -right-2 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-0.5 text-[8px] font-bold text-white">
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
