/**
 * Display currency for prices. Pure and free of Node imports, so client components can use it.
 *
 * Prices are published in USD and stay in USD in /data; this module only changes how a number
 * is shown. The rate is a reference rate (see data/fx.json), so a converted figure is an
 * estimate and the page prints the rate's own date beside it. Nothing here can reach a score,
 * a rank, a filter threshold or the cost frontier: those are all computed on USD.
 */

export const CURRENCIES = ["USD", "MXN"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** USD to MXN reference rate, as data/fx.json publishes it. */
export type FxRate = {
  /** Pesos per US dollar. */
  mxn: number;
  /** The day the central bank fixed this rate, not the day it was fetched. */
  date: string;
  /** Who published it, for the caption. */
  publisher: string;
};

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

/**
 * The currency actually in effect. MXN with no usable rate is USD: showing a peso symbol over
 * an unconverted dollar amount would be a wrong number, which is worse than an unconverted one.
 */
export function effectiveCurrency(currency: Currency, fx: FxRate | null): Currency {
  return currency === "MXN" && fx && Number.isFinite(fx.mxn) && fx.mxn > 0 ? "MXN" : "USD";
}

/**
 * Both carry their country. In Mexico "$" is the peso sign, so a bare "$" beside a dollar
 * price reads as pesos to the people this site is written for, and a price that looks 18 times
 * smaller than it is would be the worst way for this feature to fail.
 */
const SYMBOL: Record<Currency, string> = { USD: "US$", MXN: "MX$" };

export function symbol(currency: Currency): string {
  return SYMBOL[currency];
}

export function convert(usd: number, currency: Currency, fx: FxRate | null): number {
  return effectiveCurrency(currency, fx) === "MXN" && fx ? usd * fx.mxn : usd;
}

/** Same rule the table has always used: three decimals below one unit, two from one up. */
function digits(value: number): string {
  return value < 1 ? value.toFixed(3) : value.toFixed(2);
}

/** The figure alone, for a table column whose header carries the sign. null prints "·". */
export function formatPriceDigits(usd: number | null, currency: Currency, fx: FxRate | null): string {
  if (usd === null) return "·";
  return digits(convert(usd, effectiveCurrency(currency, fx), fx));
}

/** A price per million tokens with its sign, e.g. "US$3.00" or "MX$56.11". null is unknown, never free. */
export function formatPrice(usd: number | null, currency: Currency, fx: FxRate | null): string {
  if (usd === null) return "·";
  return `${SYMBOL[effectiveCurrency(currency, fx)]}${formatPriceDigits(usd, currency, fx)}`;
}

/** Short form for axis ticks, where room is tight. */
export function formatAxisPrice(usd: number, currency: Currency, fx: FxRate | null): string {
  const shown = effectiveCurrency(currency, fx);
  const value = convert(usd, shown, fx);
  if (value >= 10) return `${SYMBOL[shown]}${value.toFixed(0)}`;
  if (value >= 1) return `${SYMBOL[shown]}${value.toFixed(value % 1 === 0 ? 0 : 1)}`;
  return `${SYMBOL[shown]}${Number(value.toFixed(3))}`;
}

/** The rate as printed in a caption: four decimals at most, no trailing noise. */
export function formatRate(mxn: number): string {
  return String(Number(mxn.toFixed(4)));
}

/**
 * A monthly plan fee in the currency it is charged in, whole units where it is whole:
 * "MX$399", "US$20". Never converted: a plan costs what its own page says in its own
 * country, and that is the figure that is printed.
 */
export function formatFee(amount: number, charged: Currency): string {
  const text = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(amount < 100 ? 2 : 0);
  return `${SYMBOL[charged]}${text}`;
}

/**
 * The same fee in the currency the reader chose, for a "roughly" beside the real figure.
 * Null when it is already in that currency or there is no usable rate: in both cases there
 * is nothing honest to add. The result is an estimate at a reference rate, never a price.
 */
export function convertFee(
  amount: number,
  charged: Currency,
  shown: Currency,
  fx: FxRate | null,
): number | null {
  if (charged === shown || !fx || !Number.isFinite(fx.mxn) || fx.mxn <= 0) return null;
  return charged === "USD" ? amount * fx.mxn : amount / fx.mxn;
}
