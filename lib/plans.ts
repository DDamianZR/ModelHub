/**
 * Ordering for the plans page. Pure and free of Node imports.
 *
 * Plans are listed cheapest first, which is the question a reader on a budget brings. Fees
 * in different currencies are put on one scale with the reference rate only to decide the
 * order; the figure printed is always the one charged. A plan with no listed fee has no
 * place on that scale and goes last, and without a usable rate fees are not compared across
 * currencies at all: the list falls back to names rather than guess.
 *
 * Nothing here looks at who offers a plan.
 */
import type { FxRate } from "./currency";
import type { Plan } from "./types";

/** The fee on a dollar scale, for ordering only. Null when it cannot be placed. */
function comparable(plan: Plan, fx: FxRate | null): number | null {
  if (plan.price_per_month === null || plan.currency === null) return null;
  if (plan.currency === "USD") return plan.price_per_month;
  return fx && Number.isFinite(fx.mxn) && fx.mxn > 0 ? plan.price_per_month / fx.mxn : null;
}

export function sortPlans(plans: Plan[], fx: FxRate | null): Plan[] {
  const byName = (a: Plan, b: Plan) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const mixed = new Set(plans.map((plan) => plan.currency).filter(Boolean)).size > 1;
  const usable = fx !== null && Number.isFinite(fx.mxn) && fx.mxn > 0;
  // Two currencies and no rate to relate them: comparing 399 with 20 would order by unit.
  if (mixed && !usable) return [...plans].sort(byName);
  return [...plans].sort((a, b) => {
    const left = comparable(a, fx);
    const right = comparable(b, fx);
    if (left === null || right === null) {
      return left === right ? byName(a, b) : left === null ? 1 : -1;
    }
    return left - right || byName(a, b);
  });
}
