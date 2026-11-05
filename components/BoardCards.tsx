import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Surface } from "@/components/Surface";
import type { BoardCard, BoardModel } from "@/lib/types";

const SHOWN = 3;

function placeLabel(model: BoardModel, total: number): string | null {
  if (model.rank === null) return null;
  return `${model.tied_with > 0 ? "=" : "#"}${model.rank}/${total}`;
}

/**
 * The "best by" boards, one card each. A card states the highest measured value, then every
 * model nobody in the pool is measurably ahead of: more than one winner is a tie and is
 * shown as one. Cards are ordered as best_by.json orders them, never by who wins. The price
 * card shows the winner's composite beside the price, so a low price is never read as a score.
 */
export async function BoardCards({
  cards,
  rankedCount,
}: {
  cards: BoardCard[];
  rankedCount: number;
}) {
  const t = await getTranslations("home");
  const tt = await getTranslations("table");

  const title = (card: BoardCard): string => {
    if (card.id.startsWith("composite")) return t("board.composite");
    if (card.metric.startsWith("category:")) return tt(card.metric.slice("category:".length));
    if (card.id === "under_1_usd") {
      return t("board.under_1_usd", { price: card.filter.max_blended_price ?? 0 });
    }
    if (card.id === "cheapest_covered") {
      return t("board.cheapest_covered", { min: card.filter.min_coverage ?? 0 });
    }
    return t(`board.${card.id}`);
  };

  const headline = (card: BoardCard): string => {
    if (card.value === null) return "—";
    if (card.metric === "price") {
      return t("boardPerM", { value: card.value.toFixed(card.value < 1 ? 3 : 2) });
    }
    return card.value.toFixed(1);
  };

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const shown = card.winners.slice(0, SHOWN);
        const extra = card.winners.length - shown.length;
        return (
          <li key={card.id}>
            <Surface className="flex h-full flex-col gap-2 p-4">
              <span className="eyebrow">{title(card)}</span>
              <span className="num text-xl leading-none tracking-snug">{headline(card)}</span>
              <ul className="flex flex-col gap-0.5 text-sm">
                {shown.map((winner) => (
                  <li key={winner.id} className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/model/${winner.id}`}
                      className="row-shift underline-offset-2 hover:underline"
                    >
                      {winner.display_name}
                    </Link>
                    {card.metric === "price" && (
                      <span className="num text-2xs text-tertiary">
                        {t("boardComposite", { value: winner.composite.toFixed(1) })}
                      </span>
                    )}
                    {placeLabel(winner, rankedCount) && card.metric !== "price" && (
                      <span className="num text-2xs text-tertiary">
                        {placeLabel(winner, rankedCount)}
                      </span>
                    )}
                  </li>
                ))}
                {extra > 0 && (
                  <li className="num text-2xs text-tertiary">{t("boardMore", { count: extra })}</li>
                )}
              </ul>
              <p className="num mt-auto text-2xs text-tertiary">
                {card.winners.length > 1 && <>{t("boardTie", { count: card.winners.length })} · </>}
                {t("boardPool", { count: card.candidates })}
              </p>
            </Surface>
          </li>
        );
      })}
    </ul>
  );
}
