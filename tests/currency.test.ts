/**
 * lib/currency.ts: how a USD price is shown in dollars or pesos. Run with `npm run test:fit`
 * (node:test, no dependencies). The rate here is a round number so every expected value can
 * be worked out by hand; it is not the live rate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  convert,
  convertFee,
  effectiveCurrency,
  formatAxisPrice,
  formatFee,
  formatPrice,
  formatPriceDigits,
  formatRate,
  isCurrency,
  type FxRate,
} from "../lib/currency.ts";

const FX: FxRate = { mxn: 20, date: "2026-11-06", publisher: "reference" };

test("USD is the identity: the stored figure is what is shown", () => {
  assert.equal(convert(3, "USD", FX), 3);
  assert.equal(formatPrice(3, "USD", FX), "US$3.00");
  // Below one unit the figure keeps three decimals, as the table always did.
  assert.equal(formatPrice(0.045, "USD", FX), "US$0.045");
});

test("MXN multiplies by the rate and labels the peso", () => {
  // 3 USD x 20 = 60.00; 0.045 USD x 20 = 0.9 -> still below one unit, three decimals.
  assert.equal(formatPrice(3, "MXN", FX), "MX$60.00");
  assert.equal(formatPrice(0.045, "MXN", FX), "MX$0.900");
});

test("the rule for decimals follows the converted figure, not the stored one", () => {
  // 0.04 USD stays below one unit, so three decimals. 0.06 USD becomes 1.2 pesos at a rate of
  // 20, which is past one unit, so two decimals: the same stored price formats differently.
  assert.equal(formatPrice(0.04, "USD", FX), "US$0.040");
  assert.equal(formatPrice(0.06, "MXN", FX), "MX$1.20");
});

test("unknown stays unknown, in either currency, and zero stays zero", () => {
  assert.equal(formatPrice(null, "USD", FX), "·");
  assert.equal(formatPrice(null, "MXN", FX), "·");
  assert.equal(formatPriceDigits(null, "MXN", FX), "·");
  assert.equal(formatPrice(0, "MXN", FX), "MX$0.000");
});

test("no usable rate means dollars, never a peso sign over an unconverted figure", () => {
  assert.equal(effectiveCurrency("MXN", null), "USD");
  assert.equal(formatPrice(3, "MXN", null), "US$3.00");
  for (const mxn of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const broken: FxRate = { ...FX, mxn };
    assert.equal(effectiveCurrency("MXN", broken), mxn > 0 && Number.isFinite(mxn) ? "MXN" : "USD");
    if (!(mxn > 0 && Number.isFinite(mxn))) assert.equal(formatPrice(3, "MXN", broken), "US$3.00");
  }
});

test("digits-only is the same figure without its sign", () => {
  assert.equal(formatPriceDigits(3, "USD", FX), "3.00");
  assert.equal(formatPriceDigits(3, "MXN", FX), "60.00");
});

test("axis labels are short and keep the sign", () => {
  assert.equal(formatAxisPrice(1, "USD", FX), "US$1");
  assert.equal(formatAxisPrice(10, "USD", FX), "US$10");
  assert.equal(formatAxisPrice(0.5, "USD", FX), "US$0.5");
  assert.equal(formatAxisPrice(0.5, "MXN", FX), "MX$10");
  assert.equal(formatAxisPrice(0.1, "MXN", FX), "MX$2");
});

test("a fee prints in the currency it is charged in, whole units when whole", () => {
  assert.equal(formatFee(20, "USD"), "US$20");
  assert.equal(formatFee(399, "MXN"), "MX$399");
  assert.equal(formatFee(9.99, "USD"), "US$9.99");
  assert.equal(formatFee(0, "MXN"), "MX$0");
  // From a hundred up the cents are dropped, as they were for converted fees.
  assert.equal(formatFee(129.5, "MXN"), "MX$130");
});

test("a fee is only converted across currencies, and only with a rate", () => {
  // FX is 20 pesos per dollar: 400 pesos are 20 dollars, 20 dollars are 400 pesos.
  assert.equal(convertFee(400, "MXN", "USD", FX), 20);
  assert.equal(convertFee(20, "USD", "MXN", FX), 400);
  // Already in the reader's currency: nothing to add.
  assert.equal(convertFee(399, "MXN", "MXN", FX), null);
  assert.equal(convertFee(20, "USD", "USD", FX), null);
  // No usable rate: no estimate, rather than a wrong one.
  assert.equal(convertFee(399, "MXN", "USD", null), null);
  assert.equal(convertFee(399, "MXN", "USD", { ...FX, mxn: 0 }), null);
  assert.equal(convertFee(399, "MXN", "USD", { ...FX, mxn: Number.NaN }), null);
});

test("the rate prints without floating-point noise", () => {
  assert.equal(formatRate(18.704), "18.704");
  assert.equal(formatRate(18.70400000001), "18.704");
  assert.equal(formatRate(20), "20");
});

test("only the two known codes are currencies", () => {
  assert.equal(isCurrency("USD"), true);
  assert.equal(isCurrency("MXN"), true);
  for (const value of ["EUR", "usd", "", null, undefined, 1]) assert.equal(isCurrency(value), false);
});
