import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Price, PriceShort } from "@/components/CurrencyProvider";
import type { BoardCard } from "@/lib/types";

const SHOWN = 2;

/**
 * The "best by" boards as one compact row of links. Each entry names the criterion and the
 * highest measured value, then every model nobody in the pool is measurably ahead of: more
 * than one is a tie and is written as one. Entries keep the order best_by.json gives them,
 * never an order by who wins, and nothing is styled by who the winner is. The price board
 * shows the winner's composite beside the price, so a low price is never read as a score.
 */
export async function BoardCards({ cards }: { cards: BoardCard[] }) {
  const t = await getTranslations("home");
  const tt = await getTranslations("table");

  const title = (card: BoardCard): React.ReactNode => {
    if (card.id.startsWith("composite")) return t("board.composite");
    if (card.metric.startsWith("category:")) return tt(card.metric.slice("category:".length));
    if (card.id === "under_1_usd") {
      const ceiling = card.filter.max_blended_price ?? 0;
      return t.rich("board.under_1_usd", { price: () => <PriceShort usd={ceiling} /> });
    }
    if (card.id === "cheapest_covered") {
      return t("board.cheapest_covered", { min: card.filter.min_coverage ?? 0 });
    }
    return t(`board.${card.id}`);
  };

  const value = (card: BoardCard): React.ReactNode => {
    if (card.value === null) return "—";
    if (card.metric === "price") {
      const usd = card.value;
      return t.rich("boardPerM", { value: () => <Price usd={usd} /> });
    }
    return card.value.toFixed(1);
  };

  return (
    <ul className="flex flex-col gap-x-8 gap-y-2 text-sm sm:flex-row sm:flex-wrap">
      {cards.map((card) => {
        const shown = card.winners.slice(0, SHOWN);
        const extra = card.winners.length - shown.length;
        return (
          <li key={card.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-tertiary">{title(card)}</span>
            <span className="num text-xs text-tertiary">{value(card)}</span>
            {shown.map((winner, index) => (
              <span key={winner.id}>
                {index > 0 && <span className="text-tertiary"> = </span>}
                <Link
                  href={`/model/${winner.id}`}
                  className="inline-block py-1.5 underline underline-offset-2"
                >
                  {winner.display_name}
                </Link>
              </span>
            ))}
            {extra > 0 && <span className="num text-xs text-tertiary">{t("boardMore", { count: extra })}</span>}
          </li>
        );
      })}
    </ul>
  );
}
