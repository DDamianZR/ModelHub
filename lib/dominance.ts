/**
 * Price-versus-composite dominance, the same rule as `pareto_frontier` in
 * scripts/ingest/derived.py: B dominates A when B is no more expensive and scores no lower,
 * and is strictly better on at least one axis. Two models with identical price and
 * composite dominate neither.
 *
 * No Node imports: the home chart reads this in the browser to say, per model, which
 * others beat it and which it beats. Nothing here is a new measurement; it restates the
 * published frontier flag from the same two numbers, and tests/dominance.test.ts holds the
 * two to each other.
 */

export type Priced = { id: string; price: number; composite: number };

export function dominates(b: Priced, a: Priced): boolean {
  return (
    b.id !== a.id &&
    b.price <= a.price &&
    b.composite >= a.composite &&
    (b.price < a.price || b.composite > a.composite)
  );
}

export type Dominance = {
  /** Models that are no more expensive, score no lower, and are better on one axis. */
  beatenBy: string[];
  /** Models this one beats under the same rule. */
  beats: string[];
};

export function dominanceMap(points: Priced[]): Map<string, Dominance> {
  const out = new Map<string, Dominance>();
  for (const p of points) out.set(p.id, { beatenBy: [], beats: [] });
  for (const a of points) {
    for (const b of points) {
      if (dominates(b, a)) {
        out.get(a.id)!.beatenBy.push(b.id);
        out.get(b.id)!.beats.push(a.id);
      }
    }
  }
  return out;
}
