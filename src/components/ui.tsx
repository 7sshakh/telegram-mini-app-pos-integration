"use client";

import { useEffect, useState, type ReactNode } from "react";

import { formatSum } from "@/lib/format";
import { haptic } from "@/lib/client/telegram";
import { useApp } from "@/lib/client/store";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Money({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span className={className}>
      {formatSum(value)} <span className="text-[0.72em] font-medium opacity-70">so‘m</span>
    </span>
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled,
  loading,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger" | "soft";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    variant === "primary"
      ? "btn-primary"
      : variant === "ghost"
        ? "btn-ghost text-white"
        : variant === "danger"
          ? "bg-flame/15 text-flame border border-flame/40 rounded-2xl font-semibold"
          : "bg-white/5 text-white/90 border border-white/10 rounded-2xl font-semibold";
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={() => {
        if (disabled || loading) return;
        haptic("medium");
        onClick?.();
      }}
      className={`tap flex items-center justify-center gap-2 px-4 py-3 text-[15px] ${base} ${className}`}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const webApp = window.Telegram?.WebApp;
    const handler = () => onClose();
    try {
      webApp?.BackButton.show();
      webApp?.BackButton.onClick(handler);
    } catch {
      // ignore
    }
    document.body.style.overflow = "hidden";
    return () => {
      try {
        webApp?.BackButton.offClick(handler);
        webApp?.BackButton.hide();
      } catch {
        // ignore
      }
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2">
          <div className="min-w-0">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/15" />
            {title ? <h2 className="truncate text-[17px] font-bold">{title}</h2> : null}
            {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="tap mt-3 rounded-full bg-white/8 p-2 text-white/70" aria-label="Yopish">
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>
        <div className="sheet-body no-scrollbar flex-1 px-5 pb-4">{children}</div>
        {footer ? <div className="border-t border-white/8 bg-ink-soft/90 px-5 py-3">{footer}</div> : null}
      </div>
    </>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  emoji,
  title,
  text,
  action,
}: {
  emoji: string;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rise flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="text-5xl">{emoji}</div>
      <h3 className="text-[16px] font-semibold">{title}</h3>
      {text ? <p className="max-w-[280px] text-[13px] leading-relaxed text-muted">{text}</p> : null}
      {action}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-[15px] font-bold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = 50,
  size = "md",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "h-8 w-8 text-[16px]" : "h-10 w-10 text-[18px]";
  return (
    <div className="flex items-center gap-1 rounded-full bg-white/6 p-1">
      <button
        className={`tap ${pad} flex items-center justify-center rounded-full bg-white/8 font-bold`}
        onClick={() => {
          haptic("light");
          onChange(Math.max(min, value - 1));
        }}
        aria-label="Kamaytirish"
      >
        −
      </button>
      <span className={`min-w-7 text-center font-bold ${size === "sm" ? "text-[14px]" : "text-[15px]"}`}>{value}</span>
      <button
        className={`tap ${pad} flex items-center justify-center rounded-full bg-brand font-bold text-black`}
        onClick={() => {
          haptic("light");
          onChange(Math.min(max, value + 1));
        }}
        aria-label="Ko‘paytirish"
      >
        +
      </button>
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone =
    status === "cancelled"
      ? "bg-flame/15 text-flame border-flame/30"
      : status === "completed" || status === "delivered"
        ? "bg-mint/15 text-mint border-mint/30"
        : status === "new"
          ? "bg-white/8 text-white/80 border-white/15"
          : "bg-brand/15 text-brand border-brand/30";
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${tone}`}>{label}</span>;
}

export function Toaster() {
  const { state } = useApp();
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pt-[calc(var(--safe-top)+10px)]">
      {state.toasts.map((toast) => (
        <div
          key={toast.id}
          className={`rise pointer-events-auto w-full max-w-[420px] rounded-2xl border px-4 py-3 text-[13px] font-medium shadow-xl backdrop-blur ${
            toast.kind === "error"
              ? "border-flame/40 bg-flame/15 text-white"
              : toast.kind === "ok"
                ? "border-mint/40 bg-mint/15 text-white"
                : "border-white/12 bg-ink-card/95 text-white"
          }`}
        >
          {toast.text}
        </div>
      ))}
    </div>
  );
}

export function ConnectionBanner() {
  const { state } = useApp();
  if (state.online && state.catalog?.meta.posOnline !== false) {
    return state.catalog?.meta.mockMode ? (
      <div className="mx-4 mb-2 rounded-xl border border-brand/25 bg-brand/10 px-3 py-2 text-[11.5px] leading-snug text-brand">
        DEMO rejim: POS mock ma’lumotlari ishlatilmoqda. Ishlab chiqarishda POS_MODE=pos qiling.
      </div>
    ) : null;
  }
  return (
    <div className="mx-4 mb-2 rounded-xl border border-flame/30 bg-flame/10 px-3 py-2 text-[11.5px] leading-snug text-white">
      {state.online
        ? "POS kompyuteri hozir offline. Buyurtmalar navbatda saqlanadi va aloqa tikolgach yuboriladi."
        : "Internet aloqasi yo‘q. Savatchangiz saqlanib qoladi."}
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const paths: Record<string, ReactNode> = {
  close: <path d="M6 6l12 12M18 6L6 18" strokeWidth="2" strokeLinecap="round" />,
  cart: (
    <>
      <path d="M3 5h2.2l2.3 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6.4" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="20.5" r="1.4" />
      <circle cx="17" cy="20.5" r="1.4" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h10" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" strokeWidth="1.6" />
      <path d="M9 8h6M9 12h6" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" strokeWidth="1.7" />
      <path d="M4.5 20c1.4-3.6 4-5.4 7.5-5.4S18.1 16.4 19.5 20" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" strokeWidth="2" strokeLinecap="round" />,
  minus: <path d="M5 12h14" strokeWidth="2" strokeLinecap="round" />,
  location: (
    <>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z" strokeWidth="1.7" />
      <circle cx="12" cy="10" r="2.6" strokeWidth="1.7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" strokeWidth="1.7" />
      <path d="M12 7.5V12l3 2" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  check: <path d="M4.5 12.5l5 5 10-11" strokeWidth="2" strokeLinecap="round" />,
  chevron: <path d="M9 6l6 6-6 6" strokeWidth="1.8" strokeLinecap="round" />,
  back: <path d="M15 5l-7 7 7 7" strokeWidth="1.8" strokeLinecap="round" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" strokeWidth="1.7" />
      <path d="M16 16l4.5 4.5" strokeWidth="1.7" strokeLinecap="round" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="17" r="3" strokeWidth="1.6" />
      <circle cx="18" cy="17" r="3" strokeWidth="1.6" />
      <path d="M9 17l3-8h4l-1.5 8M12 9l-2-3h3" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  phone: (
    <path d="M5 4h3l2 5-2.2 1.6a12 12 0 0 0 5.6 5.6L15 14l5 2v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 6.2A2 2 0 0 1 5 4z" strokeWidth="1.6" strokeLinecap="round" />
  ),
  spark: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" strokeWidth="1.5" />,
};

export function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof paths | string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={className} aria-hidden>
      {paths[name] ?? null}
    </svg>
  );
}
