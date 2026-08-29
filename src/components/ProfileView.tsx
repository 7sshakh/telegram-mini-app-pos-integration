"use client";

import { useState } from "react";

import { AddressSheet } from "@/components/AddressSheet";
import { Button, Icon, Money, SectionTitle } from "@/components/ui";
import { requestContact } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";
import { ADDRESS_LABELS, PAYMENT_LABELS } from "@/lib/uz";

export function ProfileView() {
  const { state, updatePhone, deleteAddress, devLogin, refreshMenu } = useApp();
  const [phone, setPhone] = useState(state.customer?.phone ?? "");
  const [saving, setSaving] = useState(false);
  const [addressSheet, setAddressSheet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const customer = state.customer;
  const settings = state.catalog?.settings;

  return (
    <div className="px-4">
      <div className="card mb-4 flex items-center gap-3 p-4">
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-brand to-brand-deep text-[18px] font-extrabold text-black">
          {customer?.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={customer.photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (customer?.firstName ?? "?").slice(0, 1).toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">
            {customer?.firstName ?? "Mijoz"} {customer?.lastName ?? ""}
          </p>
          <p className="text-[11.5px] text-muted">
            {customer?.username ? `@${customer.username}` : "Telegram"} · ID {customer?.telegramId ?? "—"}
          </p>
        </div>
      </div>

      <div className="card mb-4 p-4">
        <p className="mb-3 text-[13px] font-bold">📱 Telefon raqami</p>
        <div className="flex gap-2">
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            inputMode="tel"
            placeholder="+998 90 123 45 67"
          />
          <Button
            variant="ghost"
            className="shrink-0 px-4"
            loading={saving}
            onClick={async () => {
              setSaving(true);
              await updatePhone(phone.trim());
              setSaving(false);
            }}
          >
            Saqlash
          </Button>
        </div>
        <button
          onClick={async () => {
            const ok = await requestContact();
            if (!ok) return;
          }}
          className="tap mt-2 text-[11.5px] font-semibold text-brand"
        >
          Telegram orqali raqamni ulashish
        </button>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Raqam 4+1 aksiyasi uchun kerak — faqat doimiy mijozlar uchun. Ma’lumotlaringiz uchinchi tomonga berilmaydi.
        </p>
      </div>

      <div className="card mb-4 p-4">
        <p className="mb-3 text-[13px] font-bold">🎁 Doimiy mijoz</p>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <p className="text-[20px] font-extrabold text-brand">{customer?.completedOrders ?? 0}</p>
            <p className="text-[11px] text-muted">yakunlangan buyurtma</p>
          </div>
          <div className="flex-1">
            <p className="text-[20px] font-extrabold">{customer?.loyaltyEligible ? "Aktiv" : "—"}</p>
            <p className="text-[11px] text-muted">4+1 aksiyasi</p>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] leading-snug text-muted">
          {customer?.loyaltyEligible
            ? "Siz 4+1 aksiyasidan foydalanishingiz mumkin: har 5 ta hotdogdan 1 tasi bepul."
            : "Birinchi buyurtmangizdan keyin 4+1 aksiyasi ochiladi."}
        </p>
      </div>

      <SectionTitle
        right={
          <button onClick={() => setAddressSheet(true)} className="tap text-[11.5px] font-semibold text-brand">
            + Qo‘shish
          </button>
        }
      >
        Manzillarim
      </SectionTitle>
      <div className="mb-4 space-y-2">
        {state.addresses.length === 0 ? (
          <p className="card p-4 text-center text-[12.5px] text-muted">Saqlangan manzil yo‘q</p>
        ) : (
          state.addresses.map((address) => (
            <div key={address.id} className="card flex items-center gap-3 p-3">
              <span className="text-[18px]">{address.label === "home" ? "🏠" : address.label === "work" ? "🏢" : "📍"}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{address.addressLine}</p>
                <p className="truncate text-[11px] text-muted">
                  {ADDRESS_LABELS[address.label]}
                  {address.apartment ? ` · Kv. ${address.apartment}` : ""}
                  {address.entrance ? ` · Podyezd ${address.entrance}` : ""}
                  {address.lat ? " · 📍 lokatsiya" : ""}
                </p>
              </div>
              <button onClick={() => void deleteAddress(address.id)} className="tap p-2 text-white/40" aria-label="O‘chirish">
                <Icon name="trash" className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      {settings ? (
        <div className="card mb-4 space-y-1.5 p-4 text-[12.5px]">
          <p className="mb-1 text-[13px] font-bold">ℹ️ {settings.brandName}</p>
          {settings.workHours ? (
            <div className="flex justify-between">
              <span className="text-muted">Ish vaqti</span>
              <span className="font-semibold">
                {settings.workHours.open} — {settings.workHours.close}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-muted">Telefon</span>
            <span className="font-semibold">{settings.phone || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Manzil</span>
            <span className="max-w-[60%] text-right font-semibold">{settings.address || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Yetkazish</span>
            <span className="font-semibold">
              {settings.deliveryEnabled ? <Money value={settings.deliveryFee} /> : "yo‘q"}
              {settings.freeDeliveryFrom > 0 ? ` · ${settings.freeDeliveryFrom.toLocaleString("ru-RU")}+ bepul` : ""}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">To‘lov turlari</span>
            <span className="max-w-[60%] text-right font-semibold">
              {settings.paymentMethods.filter((method) => method.enabled).map((method) => PAYMENT_LABELS[method.id] ?? method.label).join(", ")}
            </span>
          </div>
        </div>
      ) : null}

      <div className="card mb-6 p-4 text-[11.5px] leading-relaxed text-muted">
        <div className="mb-2 flex items-center gap-2 font-semibold text-white/80">
          <Icon name="spark" className="h-4 w-4 text-brand" /> Holat
        </div>
        Menyu manbai: <b className="text-white/80">{state.catalog?.meta.source === "pos" ? "VIBE POS (jonli)" : "demo"}</b>
        <br />
        POS kompyuteri: <b className={state.catalog?.meta.posOnline ? "text-mint" : "text-flame"}>
          {state.catalog?.meta.posOnline ? "online" : "offline"}
        </b>
        <br />
        Katalog yangilangan: {new Date(state.catalog?.meta.fetchedAt ?? Date.now()).toLocaleTimeString("uz-UZ")}
        <div className="mt-3 flex gap-2">
          <button
            onClick={async () => {
              setRefreshing(true);
              await refreshMenu();
              setRefreshing(false);
            }}
            className="tap btn-ghost px-3 py-2 text-[12px] font-semibold"
          >
            {refreshing ? "Yangilanmoqda…" : "Menyuni yangilash"}
          </button>
          {state.devLoginAvailable ? (
            <button onClick={() => void devLogin()} className="tap btn-ghost px-3 py-2 text-[12px] font-semibold">
              Dev kirish
            </button>
          ) : null}
        </div>
      </div>

      <AddressSheet open={addressSheet} onClose={() => setAddressSheet(false)} initial={null} />
    </div>
  );
}
