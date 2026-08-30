"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

import { AddressSheet } from "@/components/AddressSheet";
import { Button, Icon, Money, SectionTitle } from "@/components/ui";
import { requestContact, getWebApp, haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { ADDRESS_LABELS } from "@/lib/uz";

const ADMIN_TELEGRAM_ID = 6997553667;
const SUPPORT_TELEGRAM_ID = "8525601965";
const WORKPLACE_PHONE = "+998979118070";

export function ProfileView() {
  const { state, updatePhone, deleteAddress, refreshMenu, refreshProfile, toast } = useApp();
  const [phone, setPhone] = useState(state.customer?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [addressSheet, setAddressSheet] = useState(false);

  const customer = state.customer;
  const isAdmin = customer?.telegramId === ADMIN_TELEGRAM_ID;

  const openSupport = () => {
    haptic("light");
    const webApp = getWebApp();
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(`https://t.me/${SUPPORT_TELEGRAM_ID}`);
    } else {
      window.open(`https://t.me/${SUPPORT_TELEGRAM_ID}`, "_blank");
    }
  };

  const callWorkplace = () => {
    haptic("light");
    window.location.href = `tel:${WORKPLACE_PHONE}`;
  };

  return (
    <div className="px-3 pb-24 pt-2 max-w-lg mx-auto space-y-3">
      {/* Profile Card */}
      <div className="flex items-center gap-3 rounded-xl border border-white/4 bg-[#131315] p-3">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-amber-500 text-[16px] font-bold text-black">
          {customer?.photoUrl ? (
            <img src={customer.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (customer?.firstName ?? "?").slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[14px] font-bold text-white">
              {customer?.firstName ?? "Mijoz"} {customer?.lastName ?? ""}
            </p>
            {isAdmin && (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-400 border border-amber-500/30">
                ADMIN
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500">
            {customer?.username ? `@${customer.username}` : "Telegram"} · ID: {customer?.telegramId ?? "—"}
          </p>
        </div>
      </div>

      {/* ADMIN PANEL (Only for ID: 6997553667) */}
      {isAdmin && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[13px] font-bold text-amber-400 flex items-center gap-1.5">
              <span>👑</span> Admin Boshqaruv Paneli
            </h3>
            <span className="text-[9px] font-semibold text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded">
              ID: {ADMIN_TELEGRAM_ID}
            </span>
          </div>

          <p className="text-[11px] text-zinc-400">
            Siz tizim administratori sifatida biriktirilgansiz. Barcha tizim va kuryer xabarlari sizning boshqaruvingizda.
          </p>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => {
                void refreshMenu();
                toast("Menyu yangilandi ✓", "ok");
              }}
              className="tap flex items-center justify-center gap-1 rounded-lg bg-[#1a1a1d] py-2 text-[11.5px] font-bold text-white border border-white/6"
            >
              🔄 Menyuni sinxronlash
            </button>
            <button
              onClick={() => {
                void refreshProfile();
                toast("Profil yangilandi ✓", "ok");
              }}
              className="tap flex items-center justify-center gap-1 rounded-lg bg-[#1a1a1d] py-2 text-[11.5px] font-bold text-white border border-white/6"
            >
              📊 Ma'lumotlarni yangilash
            </button>
          </div>
        </div>
      )}

      {/* SUPPORT / ISHXONA */}
      <div className="rounded-xl border border-white/4 bg-[#131315] p-3 space-y-2">
        <h3 className="text-[12.5px] font-bold text-white flex items-center gap-1.5">
          <span>📞</span> Aloqa va Qo'llab-quvvatlash
        </h3>
        <p className="text-[11px] text-zinc-500">
          Ishxona raqami: <b className="text-white">+998 97 911 80 70</b> (Support ID: 8525601965)
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={callWorkplace}
            className="tap flex items-center justify-center gap-1.5 rounded-lg bg-[#1e1e22] py-2 text-[12px] font-bold text-white border border-white/5"
          >
            <span>📱</span> Qo'ng'iroq qilish
          </button>
          <button
            onClick={openSupport}
            className="tap flex items-center justify-center gap-1.5 rounded-lg bg-[#1e1e22] py-2 text-[12px] font-bold text-amber-400 border border-white/5"
          >
            <span>💬</span> Telegram Yordam
          </button>
        </div>
      </div>

      {/* Phone Number */}
      <div className="rounded-xl border border-white/4 bg-[#131315] p-3 space-y-2">
        <h3 className="text-[12.5px] font-bold text-white">📱 Telefon raqami</h3>
        <div className="flex gap-2">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+998 90 123 45 67"
            className="text-[12.5px]"
          />
          <button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await updatePhone(phone.trim());
              setSaving(false);
            }}
            className="tap rounded-lg bg-amber-500 px-3 py-1 text-[12px] font-bold text-black shrink-0"
          >
            Saqlash
          </button>
        </div>
        <button
          onClick={async () => {
            const ok = await requestContact();
            if (ok) toast("Raqam ulashildi ✓", "ok");
          }}
          className="tap text-[11px] font-semibold text-amber-400 block"
        >
          Telegram orqali raqamni ulashish
        </button>
      </div>

      {/* Addresses */}
      <div className="rounded-xl border border-white/4 bg-[#131315] p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12.5px] font-bold text-white">📍 Saqlangan manzillar</h3>
          <button onClick={() => setAddressSheet(true)} className="tap text-[11px] font-semibold text-amber-400">
            + Qo'shish
          </button>
        </div>

        {state.addresses.length === 0 ? (
          <p className="text-[11px] text-zinc-500">Hozircha manzillar yo'q.</p>
        ) : (
          <div className="space-y-1.5">
            {state.addresses.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-[#161618] p-2 text-[11.5px]">
                <div className="min-w-0 pr-2">
                  <p className="font-semibold text-white truncate">{a.addressLine}</p>
                  <p className="text-[10px] text-zinc-500">
                    {a.apartment ? `Kv ${a.apartment}` : ""} {a.floor ? `${a.floor}-qavat` : ""}
                  </p>
                </div>
                <button
                  onClick={() => deleteAddress(a.id)}
                  className="tap text-zinc-500 hover:text-red-400 p-1 text-xs"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddressSheet open={addressSheet} onClose={() => setAddressSheet(false)} />
    </div>
  );
}
