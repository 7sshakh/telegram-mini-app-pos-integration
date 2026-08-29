"use client";

import { useEffect, useState } from "react";

import { MiniMap } from "@/components/MiniMap";
import { Button, Icon, Sheet } from "@/components/ui";
import { hapticNotify } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";

export type AddressDraft = {
  label: "home" | "work" | "other";
  addressLine: string;
  apartment: string;
  entrance: string;
  floor: string;
  landmark: string;
  note: string;
  lat: number | null;
  lng: number | null;
};

const emptyDraft: AddressDraft = {
  label: "home",
  addressLine: "",
  apartment: "",
  entrance: "",
  floor: "",
  landmark: "",
  note: "",
  lat: null,
  lng: null,
};

const LABELS: { id: AddressDraft["label"]; title: string; emoji: string }[] = [
  { id: "home", title: "Uy", emoji: "🏠" },
  { id: "work", title: "Ish", emoji: "🏢" },
  { id: "other", title: "Boshqa", emoji: "📍" },
];

/**
 * Address editor with Telegram/geolocation pickup, a movable map pin and a
 * manual fallback form (works even when the user denies location permission).
 */
export function AddressSheet({
  open,
  onClose,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  initial?: AddressDraft | null;
}) {
  const { saveAddress, toast } = useApp();
  const [draft, setDraft] = useState<AddressDraft>(initial ?? emptyDraft);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (open) setDraft(initial ?? emptyDraft);
  }, [initial, open]);

  const locate = () => {
    setLocating(true);
    if (!("geolocation" in navigator)) {
      setLocating(false);
      toast("Brauzer lokatsiyani qo‘llab-quvvatlamaydi. Manzilni qo‘lda yozing.", "error");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDraft((prev) => ({
          ...prev,
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        }));
        setLocating(false);
        hapticNotify("success");
      },
      () => {
        setLocating(false);
        toast("Lokatsiya ruxsati berilmadi. Manzilni qo‘lda kiriting.", "error");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  };

  const valid = draft.addressLine.trim().length >= 4;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Yetkazib berish manzili"
      subtitle="Lokatsiya yoki manzil — ikkalasi ham ishlaydi"
      footer={
        <Button
          loading={saving}
          disabled={!valid}
          className="w-full"
          onClick={async () => {
            setSaving(true);
            const ok = await saveAddress({
              label: draft.label,
              addressLine: draft.addressLine.trim(),
              apartment: draft.apartment.trim() || null,
              entrance: draft.entrance.trim() || null,
              floor: draft.floor.trim() || null,
              landmark: draft.landmark.trim() || null,
              note: draft.note.trim() || null,
              lat: draft.lat,
              lng: draft.lng,
            });
            setSaving(false);
            if (ok) onClose();
          }}
        >
          Manzilni saqlash
        </Button>
      }
    >
      <div className="mb-4">
        <MiniMap
          lat={draft.lat}
          lng={draft.lng}
          onPick={(lat, lng) => setDraft((prev) => ({ ...prev, lat, lng }))}
          onLocate={locate}
          height={200}
        />
        {locating ? (
          <p className="mt-2 text-[11.5px] text-brand">Lokatsiya aniqlanmoqda…</p>
        ) : draft.lat !== null ? (
          <p className="mt-2 text-[11.5px] text-mint">
            Pin tanlandi: {draft.lat.toFixed(5)}, {draft.lng?.toFixed(5)}
          </p>
        ) : (
          <p className="mt-2 text-[11.5px] text-muted">
            Ruxsat berilmasa ham manzilni qo‘lda yozib buyurtma berishingiz mumkin.
          </p>
        )}
      </div>

      <div className="mb-3 flex gap-2">
        {LABELS.map((item) => (
          <button
            key={item.id}
            onClick={() => setDraft((prev) => ({ ...prev, label: item.id }))}
            className={`tap chip flex-1 px-3 py-2 text-[12.5px] font-semibold ${
              draft.label === item.id ? "chip-active" : "text-white/70"
            }`}
          >
            <span className="mr-1">{item.emoji}</span>
            {item.title}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        <Field
          label="Manzil (tuman, ko‘cha, uy)*"
          value={draft.addressLine}
          onChange={(value) => setDraft((prev) => ({ ...prev, addressLine: value }))}
          placeholder="Masalan: Chilonzor, 9-kvartal, Bunyodkor 12"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field
            label="Kvartira / uy"
            value={draft.apartment}
            onChange={(value) => setDraft((prev) => ({ ...prev, apartment: value }))}
            placeholder="42"
          />
          <Field
            label="Podyezd"
            value={draft.entrance}
            onChange={(value) => setDraft((prev) => ({ ...prev, entrance: value }))}
            placeholder="3"
          />
          <Field
            label="Qavat"
            value={draft.floor}
            onChange={(value) => setDraft((prev) => ({ ...prev, floor: value }))}
            placeholder="5"
          />
          <Field
            label="Mo‘ljal"
            value={draft.landmark}
            onChange={(value) => setDraft((prev) => ({ ...prev, landmark: value }))}
            placeholder="Makab oldida"
          />
        </div>
        <Field
          label="Yetkazib berish uchun izoh"
          value={draft.note}
          onChange={(value) => setDraft((prev) => ({ ...prev, note: value }))}
          placeholder="Kod 1234, qo‘ng‘iroq qiling"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-white/4 p-3 text-[11.5px] leading-relaxed text-muted">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-white/80">
          <Icon name="location" className="h-3.5 w-3.5" /> Nima uchun kerak?
        </div>
        Kuryer manzilni tez topishi uchun. Lokatsiya va manzil buyurtma bilan birga POS tizimiga yuboriladi.
      </div>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11.5px] font-semibold text-white/70">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} maxLength={200} />
    </label>
  );
}
