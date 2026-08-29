"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { buildQuote } from "@/lib/pricing";
import type {
  AddressDTO,
  CartLineInput,
  CustomerDTO,
  OrderAddress,
  OrderDTO,
  OrderType,
  PaymentMethod,
  PosCategory,
  PosProduct,
  PosCatalog,
  PromotionDef,
  Quote,
  StoreSettings,
} from "@/lib/types";
import { ApiError, api, getToken, newIdempotencyKey, persistCart, readPersistedCart, setToken } from "./api";
import { getWebApp, haptic, hapticNotify } from "./telegram";

export type MenuMeta = {
  source: "pos" | "mock";
  posOnline: boolean;
  stale: boolean;
  degraded: boolean;
  fetchedAt: string;
  catalogVersion: string;
  mockMode: boolean;
};

type MenuResponse = {
  brand: string;
  currency: string;
  categories: PosCategory[];
  products: PosProduct[];
  settings: StoreSettings;
  promotions: PromotionDef[];
  meta: MenuMeta;
};

type ProfileResponse = {
  customer: CustomerDTO;
  addresses: AddressDTO[];
  recentOrders: OrderDTO[];
  settings: StoreSettings;
  meta: { posOnline: boolean; source: string };
};

export type CartItem = {
  key: string;
  productId: string;
  qty: number;
  modifiers: { id: string; qty: number }[];
  note?: string;
};

export type CheckoutState = {
  orderType: OrderType;
  asap: boolean;
  scheduledFor: string | null;
  address: OrderAddress | null;
  addressId: string | null;
  paymentMethod: PaymentMethod;
  cashGiven: number;
  cashPart: number;
  cardPart: number;
  promoCode: string | null;
  note: string;
};

export type Toast = { id: string; text: string; kind: "ok" | "error" | "info" };

export type Tab = "menu" | "cart" | "orders" | "profile";

type State = {
  boot: "loading" | "ready" | "error";
  bootError: string | null;
  devLoginAvailable: boolean;
  token: string | null;
  customer: CustomerDTO | null;
  catalog: MenuResponse | null;
  catalogLoading: boolean;
  cart: CartItem[];
  addresses: AddressDTO[];
  recentOrders: OrderDTO[];
  checkout: CheckoutState;
  tab: Tab;
  activeOrderId: string | null;
  lastOrder: OrderDTO | null;
  submitting: boolean;
  toasts: Toast[];
  online: boolean;
};

type Action =
  | { type: "boot/ready"; token: string | null; devLoginAvailable: boolean }
  | { type: "boot/error"; message: string }
  | { type: "session"; token: string | null; customer: CustomerDTO | null }
  | { type: "catalog/loading" }
  | { type: "catalog"; catalog: MenuResponse }
  | { type: "profile"; customer: CustomerDTO; addresses: AddressDTO[]; recentOrders: OrderDTO[] }
  | { type: "cart/restore"; cart: CartItem[] }
  | { type: "cart/add"; item: CartItem }
  | { type: "cart/qty"; key: string; qty: number }
  | { type: "cart/remove"; key: string }
  | { type: "cart/clear" }
  | { type: "checkout"; patch: Partial<CheckoutState> }
  | { type: "tab"; tab: Tab }
  | { type: "order/active"; orderId: string | null; order: OrderDTO | null }
  | { type: "submitting"; value: boolean }
  | { type: "toast/push"; toast: Toast }
  | { type: "toast/pop"; id: string }
  | { type: "online"; value: boolean };

const defaultCheckout: CheckoutState = {
  orderType: "delivery",
  asap: true,
  scheduledFor: null,
  address: null,
  addressId: null,
  paymentMethod: "cash",
  cashGiven: 0,
  cashPart: 0,
  cardPart: 0,
  promoCode: null,
  note: "",
};

const initialState: State = {
  boot: "loading",
  bootError: null,
  devLoginAvailable: false,
  token: null,
  customer: null,
  catalog: null,
  catalogLoading: true,
  cart: [],
  addresses: [],
  recentOrders: [],
  checkout: defaultCheckout,
  tab: "menu",
  activeOrderId: null,
  lastOrder: null,
  submitting: false,
  toasts: [],
  online: true,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "boot/ready":
      return { ...state, boot: "ready", token: action.token, devLoginAvailable: action.devLoginAvailable };
    case "boot/error":
      return { ...state, boot: "error", bootError: action.message, catalogLoading: false };
    case "session":
      return { ...state, token: action.token, customer: action.customer };
    case "catalog/loading":
      return { ...state, catalogLoading: true };
    case "catalog": {
      const settings = action.catalog.settings;
      return {
        ...state,
        catalog: action.catalog,
        catalogLoading: false,
        checkout: {
          ...state.checkout,
          paymentMethod: state.checkout.paymentMethod ?? settings.paymentMethods.find((m) => m.enabled)?.id ?? "cash",
          orderType: settings.deliveryEnabled
            ? state.checkout.orderType
            : settings.pickupEnabled
              ? "pickup"
              : settings.dineInEnabled
                ? "dine_in"
                : state.checkout.orderType,
        },
      };
    }
    case "profile": {
      const preferred = action.addresses.find((a) => a.isDefault) ?? action.addresses[0] ?? null;
      return {
        ...state,
        customer: action.customer,
        addresses: action.addresses,
        recentOrders: action.recentOrders,
        checkout: preferred
          ? {
              ...state.checkout,
              address: state.checkout.address ?? {
                label: preferred.label,
                addressLine: preferred.addressLine,
                apartment: preferred.apartment ?? undefined,
                entrance: preferred.entrance ?? undefined,
                floor: preferred.floor ?? undefined,
                landmark: preferred.landmark ?? undefined,
                note: preferred.note ?? undefined,
                lat: preferred.lat,
                lng: preferred.lng,
              },
              addressId: state.checkout.addressId ?? preferred.id,
            }
          : state.checkout,
      };
    }
    case "cart/restore":
      return { ...state, cart: action.cart };
    case "cart/add":
      return { ...state, cart: [...state.cart, action.item] };
    case "cart/qty":
      return {
        ...state,
        cart: state.cart
          .map((item) => (item.key === action.key ? { ...item, qty: action.qty } : item))
          .filter((item) => item.qty > 0),
      };
    case "cart/remove":
      return { ...state, cart: state.cart.filter((item) => item.key !== action.key) };
    case "cart/clear":
      return { ...state, cart: [], checkout: { ...state.checkout, note: "", promoCode: null } };
    case "checkout":
      return { ...state, checkout: { ...state.checkout, ...action.patch } };
    case "tab":
      return { ...state, tab: action.tab };
    case "order/active":
      return { ...state, activeOrderId: action.orderId, lastOrder: action.order, tab: action.orderId ? "orders" : state.tab };
    case "submitting":
      return { ...state, submitting: action.value };
    case "toast/push":
      return { ...state, toasts: [...state.toasts.slice(-2), action.toast] };
    case "toast/pop":
      return { ...state, toasts: state.toasts.filter((toast) => toast.id !== action.id) };
    case "online":
      return { ...state, online: action.value };
    default:
      return state;
  }
}

function cartKey(productId: string, modifiers: { id: string; qty: number }[], note?: string): string {
  const mods = [...modifiers].sort((a, b) => a.id.localeCompare(b.id)).map((m) => `${m.id}x${m.qty}`).join(",");
  return `${productId}|${mods}|${note ?? ""}`;
}

function toCartLines(cart: CartItem[]): CartLineInput[] {
  return cart.map((item) => ({ productId: item.productId, qty: item.qty, modifiers: item.modifiers, note: item.note }));
}

type AppContextValue = {
  state: State;
  cartCount: number;
  estimate: Quote | null;
  estimateError: string | null;
  toast: (text: string, kind?: Toast["kind"]) => void;
  addToCart: (product: PosProduct, qty: number, modifiers: { id: string; qty: number }[], note?: string) => void;
  setQty: (key: string, qty: number) => void;
  removeItem: (key: string) => void;
  clearCart: () => void;
  setCheckout: (patch: Partial<CheckoutState>) => void;
  setTab: (tab: Tab) => void;
  refreshMenu: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  devLogin: (telegramId?: number) => Promise<void>;
  saveAddress: (address: Omit<AddressDTO, "id" | "createdAt" | "isDefault">, id?: string | null) => Promise<boolean>;
  deleteAddress: (id: string) => Promise<void>;
  updatePhone: (phone: string) => Promise<boolean>;
  submitOrder: () => Promise<OrderDTO | null>;
  repeatOrder: (order: OrderDTO) => void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const idempotencyRef = useRef<string | null>(null);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    dispatch({ type: "toast/push", toast: { id, text, kind } });
    setTimeout(() => dispatch({ type: "toast/pop", id }), 4200);
  }, []);

  const loadMenu = useCallback(async () => {
    dispatch({ type: "catalog/loading" });
    try {
      const menu = await api<MenuResponse>("/api/menu", { retries: 2, timeoutMs: 12_000 });
      dispatch({ type: "catalog", catalog: menu });
    } catch (error) {
      dispatch({ type: "catalog", catalog: {
        brand: "VIBE",
        currency: "UZS",
        categories: [],
        products: [],
        settings: {
          brandName: "VIBE — HotDog · Burger · Drinks",
          currency: "UZS",
          deliveryEnabled: true,
          pickupEnabled: true,
          dineInEnabled: false,
          deliveryFee: 0,
          freeDeliveryFrom: 0,
          minOrderAmount: 0,
          prepMinutes: 15,
          deliveryMinutes: 25,
          paymentMethods: [],
          workHours: null,
          address: "",
          phone: "",
          location: { lat: 41.2755, lng: 69.2075 },
        },
        promotions: [],
        meta: {
          source: "mock",
          posOnline: false,
          stale: true,
          degraded: true,
          fetchedAt: new Date().toISOString(),
          catalogVersion: "unavailable",
          mockMode: false,
        },
      } });
      toast("Menyu yuklanmadi. Internetni tekshirib, qayta urinib ko‘ring.", "error");
    }
  }, [toast]);

  const loadProfile = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const profile = await api<ProfileResponse>("/api/profile", { token });
      dispatch({
        type: "profile",
        customer: profile.customer,
        addresses: profile.addresses,
        recentOrders: profile.recentOrders,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setToken(null);
        dispatch({ type: "session", token: null, customer: null });
      }
    }
  }, []);

  const login = useCallback(
    async (initData?: string) => {
      const webApp = getWebApp();
      const payload = {
        initData: initData ?? webApp?.initData ?? "",
        platform: webApp?.platform,
        webAppVersion: webApp?.version,
      };
      if (!payload.initData) throw new ApiError(401, { code: "UNAUTHORIZED", message: "Telegram ma’lumotlari topilmadi." });

      const response = await api<{ token: string; customer: CustomerDTO }>("/api/auth/telegram", {
        method: "POST",
        body: payload,
        token: null,
        retries: 1,
      });
      setToken(response.token);
      dispatch({ type: "session", token: response.token, customer: response.customer });
      return response;
    },
    [],
  );

  const devLogin = useCallback(
    async (telegramId?: number) => {
      try {
        const response = await api<{ token: string; customer: CustomerDTO }>("/api/dev/login", {
          method: "POST",
          body: { telegramId: telegramId ?? 700000001, name: "Dev mijoz" },
          token: null,
        });
        setToken(response.token);
        dispatch({ type: "session", token: response.token, customer: response.customer });
        await Promise.all([loadMenu(), loadProfile()]);
        toast("Dev rejimida kirdingiz.", "ok");
      } catch {
        toast("Dev rejimi o‘chiq (DEV_MODE=false).", "error");
      }
    },
    [loadMenu, loadProfile, toast],
  );

  // --- boot -----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const webApp = getWebApp();
    try {
      webApp?.ready();
      webApp?.expand();
      webApp?.setHeaderColor?.("#07070b");
      webApp?.setBackgroundColor?.("#07070b");
      webApp?.disableVerticalSwipes?.();
    } catch {
      // older clients
    }

    const restored = readPersistedCart<CartItem[]>();
    if (Array.isArray(restored) && restored.length) dispatch({ type: "cart/restore", cart: restored });

    (async () => {
      const existing = getToken();
      const hasTelegram = !!webApp?.initData;
      try {
        if (existing) {
          try {
            await loadProfile();
          } catch {
            // handled inside loadProfile
          }
          dispatch({ type: "boot/ready", token: existing, devLoginAvailable: !hasTelegram });
        } else if (hasTelegram) {
          await login();
          await loadProfile();
          dispatch({ type: "boot/ready", token: getToken(), devLoginAvailable: false });
        } else {
          dispatch({ type: "boot/ready", token: null, devLoginAvailable: true });
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Kirishda xatolik. Ilovani qaytadan oching.";
        dispatch({ type: "boot/error", message });
      }
      if (!cancelled) await loadMenu();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMenu, loadProfile, login]);

  // persist cart
  useEffect(() => {
    persistCart(state.cart);
  }, [state.cart]);

  // connectivity
  useEffect(() => {
    const setOnline = () => {
      dispatch({ type: "online", value: true });
      toast("Internet aloqasi tiklandi.", "ok");
    };
    const setOffline = () => {
      dispatch({ type: "online", value: false });
      toast("Internet aloqasi yo‘q.", "error");
    };
    window.addEventListener("online", setOnline);
    window.addEventListener("offline", setOffline);
    dispatch({ type: "online", value: navigator.onLine });
    return () => {
      window.removeEventListener("online", setOnline);
      window.removeEventListener("offline", setOffline);
    };
  }, [toast]);

  // refresh menu when the tab becomes visible again (stock changes in POS)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadMenu();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadMenu]);

  const catalogForQuote: PosCatalog | null = useMemo(() => {
    if (!state.catalog) return null;
    return {
      version: state.catalog.meta.catalogVersion,
      source: state.catalog.meta.source,
      currency: "UZS",
      generatedAt: state.catalog.meta.fetchedAt,
      categories: state.catalog.categories,
      products: state.catalog.products,
      settings: state.catalog.settings,
    };
  }, [state.catalog]);

  const estimateResult = useMemo(() => {
    if (!catalogForQuote || state.cart.length === 0) return { quote: null, error: null as string | null };
    const result = buildQuote({
      catalog: catalogForQuote,
      lines: toCartLines(state.cart),
      orderType: state.checkout.orderType,
      promotions: state.catalog?.promotions ?? [],
      promoCode: state.checkout.promoCode,
      customer: {
        phone: state.customer?.phone ?? null,
        completedOrders: state.customer?.completedOrders ?? 0,
        promoUseCount: 0,
      },
    });
    if (result.ok) return { quote: result.quote, error: null };
    return { quote: null, error: result.error.message };
  }, [catalogForQuote, state.cart, state.checkout.orderType, state.checkout.promoCode, state.catalog?.promotions, state.customer]);

  const addToCart = useCallback(
    (product: PosProduct, qty: number, modifiers: { id: string; qty: number }[], note?: string) => {
      const key = cartKey(product.id, modifiers, note);
      dispatch({ type: "cart/add", item: { key, productId: product.id, qty, modifiers, note } });
      haptic("light");
    },
    [],
  );

  const setQty = useCallback((key: string, qty: number) => {
    dispatch({ type: "cart/qty", key, qty: Math.max(0, Math.min(50, qty)) });
    haptic("light");
  }, []);

  const removeItem = useCallback((key: string) => {
    dispatch({ type: "cart/remove", key });
    haptic("medium");
  }, []);

  const clearCart = useCallback(() => dispatch({ type: "cart/clear" }), []);

  const setCheckout = useCallback((patch: Partial<CheckoutState>) => dispatch({ type: "checkout", patch }), []);
  const setTab = useCallback((tab: Tab) => {
    dispatch({ type: "tab", tab });
    haptic("light");
  }, []);

  const refreshMenu = useCallback(async () => {
    await loadMenu();
  }, [loadMenu]);

  const refreshProfile = useCallback(async () => {
    await loadProfile();
  }, [loadProfile]);

  const saveAddress = useCallback(
    async (address: Omit<AddressDTO, "id" | "createdAt" | "isDefault">, id?: string | null) => {
      const body = {
        label: address.label,
        addressLine: address.addressLine,
        apartment: address.apartment ?? undefined,
        entrance: address.entrance ?? undefined,
        floor: address.floor ?? undefined,
        landmark: address.landmark ?? undefined,
        note: address.note ?? undefined,
        lat: address.lat ?? null,
        lng: address.lng ?? null,
      };
      try {
        await api("/api/addresses", { method: "POST", body });
        await loadProfile();
        toast("Manzil saqlandi.", "ok");
        hapticNotify("success");
        return true;
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "Manzilni saqlashda xatolik.", "error");
        hapticNotify("error");
        return false;
      }
    },
    [loadProfile, toast],
  );

  const deleteAddress = useCallback(
    async (id: string) => {
      try {
        await api(`/api/addresses?id=${id}`, { method: "DELETE" });
        await loadProfile();
        toast("Manzil o‘chirildi.", "ok");
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "O‘chirishda xatolik.", "error");
      }
    },
    [loadProfile, toast],
  );

  const updatePhone = useCallback(
    async (phone: string) => {
      try {
        const response = await api<{ customer: CustomerDTO }>("/api/profile", { method: "PATCH", body: { phone } });
        dispatch({ type: "session", token: getToken(), customer: response.customer });
        toast("Telefon raqami saqlandi.", "ok");
        hapticNotify("success");
        return true;
      } catch (error) {
        toast(error instanceof ApiError ? error.message : "Raqamni saqlashda xatolik.", "error");
        return false;
      }
    },
    [toast],
  );

  const submitOrder = useCallback(async (): Promise<OrderDTO | null> => {
    if (state.submitting) return null;
    if (!idempotencyRef.current) idempotencyRef.current = newIdempotencyKey();

    dispatch({ type: "submitting", value: true });
    try {
      const response = await api<{ order: OrderDTO; created: boolean }>("/api/orders", {
        method: "POST",
        token: getToken(),
        retries: 1,
        timeoutMs: 20_000,
        body: {
          idempotencyKey: idempotencyRef.current,
          orderType: state.checkout.orderType,
          asap: state.checkout.asap,
          scheduledFor: state.checkout.scheduledFor,
          address: state.checkout.orderType === "delivery" ? state.checkout.address : null,
          cart: toCartLines(state.cart),
          promoCode: state.checkout.promoCode,
          customerNote: state.checkout.note || null,
          payment: {
            method: state.checkout.paymentMethod,
            cashGiven: state.checkout.cashGiven || undefined,
            cashPart: state.checkout.cashPart || undefined,
            cardPart: state.checkout.cardPart || undefined,
          },
        },
      });

      idempotencyRef.current = null;
      dispatch({ type: "cart/clear" });
      dispatch({ type: "order/active", orderId: response.order.id, order: response.order });
      dispatch({ type: "submitting", value: false });
      hapticNotify("success");
      toast(response.created ? "Buyurtma yuborildi!" : "Buyurtma allaqachon qabul qilingan.", "ok");
      void loadProfile();
      return response.order;
    } catch (error) {
      dispatch({ type: "submitting", value: false });
      const message = error instanceof ApiError ? error.message : "Buyurtma yuborilmadi. Qayta urinib ko‘ring.";
      toast(message, "error");
      hapticNotify("error");
      if (error instanceof ApiError && ["OUT_OF_STOCK", "PRODUCT_UNAVAILABLE"].includes(error.code)) {
        void loadMenu();
      }
      // keep the idempotency key so a retry can never create a second order
      return null;
    }
  }, [loadMenu, loadProfile, state.cart, state.checkout, state.submitting, toast]);

  const repeatOrder = useCallback(
    (order: OrderDTO) => {
      const items: CartItem[] = order.items.map((item) => ({
        key: cartKey(item.productId, item.modifiers.map((m) => ({ id: m.id, qty: m.qty })), item.note),
        productId: item.productId,
        qty: item.qty,
        modifiers: item.modifiers.map((m) => ({ id: m.id, qty: m.qty })),
        note: item.note,
      }));
      dispatch({ type: "cart/restore", cart: items });
      dispatch({ type: "tab", tab: "cart" });
      toast("Buyurtma savatchaga qo‘shildi. Narxlarni tekshirib tasdiqlang.", "ok");
      haptic("medium");
    },
    [toast],
  );

  const cartCount = useMemo(() => state.cart.reduce((sum, item) => sum + item.qty, 0), [state.cart]);

  const value: AppContextValue = {
    state,
    cartCount,
    estimate: estimateResult.quote,
    estimateError: estimateResult.error,
    toast,
    addToCart,
    setQty,
    removeItem,
    clearCart,
    setCheckout,
    setTab,
    refreshMenu,
    refreshProfile,
    devLogin,
    saveAddress,
    deleteAddress,
    updatePhone,
    submitOrder,
    repeatOrder,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used inside AppProvider");
  return context;
}
