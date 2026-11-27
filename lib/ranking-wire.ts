/**
 * The ranking rows as they cross from the server to the browser.
 *
 * The table is a client component, so every row is serialised into the page. Most of that
 * text says nothing: `"pareto_frontier":false` on 80 rows, the provider's name and country
 * repeated once per model. Packing drops a field when it holds its usual value and stores
 * each provider once; unpacking puts both back, so the table works on the same RankingRow
 * it always did. It is a lossless encoding, never a computation: tests/ranking-wire.test.ts
 * round-trips the published cohort.
 *
 * No Node imports: the unpacking half runs in the browser.
 */
import type { RankingRow } from "./types";

/** The value each field holds on most rows. A field equal to its entry is not sent. */
const USUAL = {
  is_open_weights: false,
  pareto_frontier: false,
  provisional: false,
  awaiting_human_votes: false,
  tied_with: 0,
  context_window: null,
  blended_price_usd_per_m: null,
  composite_error: null,
} as const;

type UsualKey = keyof typeof USUAL;
type ProviderKey = "provider_id" | "provider_name" | "country";

export type PackedRow = Omit<RankingRow, UsualKey | ProviderKey | "trend"> &
  Partial<Pick<RankingRow, UsualKey | "trend">> & {
    /** Index into PackedRanking.providers. */
    p: number;
  };

export interface PackedRanking {
  /** One [provider_id, provider_name, country] per distinct combination, in first-seen order. */
  providers: Array<[string, string, string]>;
  rows: PackedRow[];
}

export function packRankingRows(rows: RankingRow[]): PackedRanking {
  const providers: Array<[string, string, string]> = [];
  const seen = new Map<string, number>();

  const packed = rows.map((row) => {
    const { provider_id, provider_name, country, trend, ...rest } = row;
    // Keyed on all three, so a model whose country differs from its provider's other
    // models gets its own entry instead of inheriting theirs.
    const key = JSON.stringify([provider_id, provider_name, country]);
    let index = seen.get(key);
    if (index === undefined) {
      index = providers.length;
      providers.push([provider_id, provider_name, country]);
      seen.set(key, index);
    }

    const out: Record<string, unknown> = { ...rest, p: index };
    for (const field of Object.keys(USUAL) as UsualKey[]) {
      if (out[field] === USUAL[field]) delete out[field];
    }
    if (trend.length > 0) out.trend = trend;
    return out as PackedRow;
  });

  return { providers, rows: packed };
}

export function unpackRankingRows(packed: PackedRanking): RankingRow[] {
  return packed.rows.map(({ p, ...rest }) => {
    const [provider_id, provider_name, country] = packed.providers[p];
    return { ...USUAL, trend: [], ...rest, provider_id, provider_name, country };
  });
}
