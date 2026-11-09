"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import {
  effectiveCurrency,
  formatAxisPrice,
  formatFee,
  formatPrice,
  formatPriceDigits,
  isCurrency,
  symbol as symbolOf,
  type Currency,
  type FxRate,
} from "@/lib/currency";

/**
 * Which currency prices are shown in, kept in the browser and shared by every component.
 *
 * Every page is prerendered, so the server and the first client render always say USD; a stored
 * choice is applied right after hydration. useSyncExternalStore is the reason that does not
 * mismatch: it renders the server snapshot during hydration and re-renders with the real one.
 * The choice is a display preference only. Nothing a ranking, a filter or the cost frontier
 * reads depends on it, and it is never sent anywhere.
 */

const STORAGE_KEY = "mh-currency";
const CHANGE_EVENT = "mh-currency-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** The choice made this visit, for when storage refuses to hold it (private mode, blocked
    cookies): it still applies until the tab closes, it just is not remembered. */
let sessionChoice: Currency | null = null;

function readStored(): Currency {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isCurrency(value)) return value;
  } catch {
    // Unreadable storage falls through to the session choice.
  }
  return sessionChoice ?? "USD";
}

const serverSnapshot = (): Currency => "USD";

type CurrencyContextValue = {
  /** What is actually shown: MXN only while a usable rate exists. */
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  fx: FxRate | null;
};

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "USD",
  setCurrency: () => {},
  fx: null,
});

export function CurrencyProvider({
  fx,
  children,
}: {
  fx: FxRate | null;
  children: React.ReactNode;
}) {
  const stored = useSyncExternalStore(subscribe, readStored, serverSnapshot);

  const setCurrency = useCallback((next: Currency) => {
    sessionChoice = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not persisted, but still applied for this visit through the event below.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency: effectiveCurrency(stored, fx), setCurrency, fx }),
    [stored, fx, setCurrency],
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const { currency, setCurrency, fx } = useContext(CurrencyContext);
  return useMemo(
    () => ({
      currency,
      setCurrency,
      fx,
      /** "$" or "MX$": the sign in effect, for column headers and units. */
      symbol: symbolOf(currency),
      /** "US$3.00" or "MX$56.11" per million tokens; null is unknown and prints "·". */
      price: (usd: number | null) => formatPrice(usd, currency, fx),
      /** The figure without its sign, for a column whose header carries it. */
      digits: (usd: number | null) => formatPriceDigits(usd, currency, fx),
      /** Short form for axis ticks. */
      axis: (usd: number) => formatAxisPrice(usd, currency, fx),
      /** A plan's monthly fee, in whole units where it is whole. */
      fee: (usd: number) => formatFee(usd, currency, fx),
    }),
    [currency, setCurrency, fx],
  );
}

/** A price as text, for server-rendered pages that cannot call the hook themselves. */
export function Price({ usd }: { usd: number | null }) {
  const { price } = useCurrency();
  return <>{price(usd)}</>;
}

/** The figure without its sign, for a table column whose header names the unit. */
export function PriceDigits({ usd }: { usd: number | null }) {
  const { digits } = useCurrency();
  return <>{digits(usd)}</>;
}

/** A round price in short form ("US$1", "MX$19"), for thresholds and axis-like labels. */
export function PriceShort({ usd }: { usd: number }) {
  const { axis } = useCurrency();
  return <>{axis(usd)}</>;
}

/** The sign in effect, for a unit written inside a translated sentence. */
export function CurrencySymbol() {
  const { symbol } = useCurrency();
  return <>{symbol}</>;
}

/** A monthly fee as text. */
export function Fee({ usd }: { usd: number }) {
  const { fee } = useCurrency();
  return <>{fee(usd)}</>;
}
