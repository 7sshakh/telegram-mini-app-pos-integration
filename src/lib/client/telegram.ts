"use client";

/** Minimal typing for the parts of the Telegram WebApp SDK we use. */
export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string; language_code?: string };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  isExpanded: boolean;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  openLink: (url: string, options?: { try_instant_view?: boolean }) => void;
  openTelegramLink: (url: string) => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  BackButton: { isVisible: boolean; show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  MainButton: {
    isVisible: boolean;
    text: string;
    show: () => void;
    hide: () => void;
    setText: (text: string) => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
  };
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  showAlert?: (message: string) => void;
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  requestContact?: (callback: (ok: boolean) => void) => void;
  openPopup?: (params: unknown) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

export function haptic(kind: "light" | "medium" | "heavy" | "rigid" | "soft" = "light"): void {
  try {
    getWebApp()?.HapticFeedback?.impactOccurred(kind);
  } catch {
    // ignore unsupported
  }
}

export function hapticNotify(type: "error" | "success" | "warning"): void {
  try {
    getWebApp()?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // ignore
  }
}

export function hapticSelect(): void {
  try {
    getWebApp()?.HapticFeedback?.selectionChanged();
  } catch {
    // ignore
  }
}

export function vibrate(pattern: number | number[] = 12): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(pattern);
  } catch {
    // ignore
  }
}

/** Ask Telegram for the user's phone number (used for the 4+1 loyalty promo). */
export function requestContact(): Promise<boolean> {
  return new Promise((resolve) => {
    const webApp = getWebApp();
    if (webApp?.requestContact) {
      webApp.requestContact((ok) => resolve(ok));
      return;
    }
    resolve(false);
  });
}

export function alertInTelegram(message: string): void {
  const webApp = getWebApp();
  if (webApp?.showAlert) webApp.showAlert(message);
  else if (typeof window !== "undefined") window.alert(message);
}

export function confirmInTelegram(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const webApp = getWebApp();
    if (webApp?.showConfirm) webApp.showConfirm(message, resolve);
    else resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  });
}
