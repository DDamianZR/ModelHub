"use client";

import { SegmentedControl } from "./SegmentedControl";
import { useCurrency } from "./CurrencyProvider";
import { CURRENCIES, type Currency } from "@/lib/currency";

/**
 * USD or MXN for every price on the page. Rendered only when a rate exists: a selector that
 * offers pesos with nothing to convert by would be a button that lies. The rate's source and
 * date sit in the control's tooltip and in the model page, so a converted figure is never
 * shown without a way to find out what it was converted with.
 *
 * Two pieces, because the header row has no room for this on a phone: at 360px it fits the
 * wordmark exactly, and any extra control squeezed the wordmark (measured). From `sm` up the
 * segmented control sits in that row; below it, a compact button sits in the navigation row.
 */
export function CurrencySwitch({ label, note }: { label: string; note: string }) {
  const { currency, setCurrency, fx } = useCurrency();
  if (!fx) return null;
  return (
    <div className="hidden sm:block" title={note}>
      <SegmentedControl<Currency>
        label={label}
        value={currency}
        onChange={setCurrency}
        options={CURRENCIES.map((code) => ({ value: code, label: code }))}
      />
      {/* A tooltip does not reach touch or keyboard users; this does, and costs nothing. */}
      <span className="sr-only">{note}</span>
    </div>
  );
}

/** The phone form: one button showing the current currency, like the theme toggle. */
export function CurrencyToggle({
  label,
  note,
  switchTo,
}: {
  label: string;
  note: string;
  /** What the button announces, per currency it would switch to. */
  switchTo: Record<Currency, string>;
}) {
  const { currency, setCurrency, fx } = useCurrency();
  if (!fx) return null;
  const next: Currency = currency === "USD" ? "MXN" : "USD";
  return (
    <button
      type="button"
      onClick={() => setCurrency(next)}
      aria-label={`${label}: ${currency}. ${switchTo[next]}. ${note}`}
      title={note}
      className="control control-sm shrink-0 text-xs sm:hidden"
    >
      {currency}
    </button>
  );
}
