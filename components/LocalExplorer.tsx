"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  GIB,
  QUANTISATIONS,
  estimate,
  formatGiB,
  frontier,
  type Estimate,
  type LocalModel,
  type Quantisation,
  type VramConfig,
} from "@/lib/vram";

/**
 * The first client interactivity in the project, and the client/server boundary is drawn
 * here on purpose: the server reads /data and /config at build time and hands down plain
 * JSON, this component owns only the three controls and the pure arithmetic in lib/vram.ts.
 * Nothing below this line touches the filesystem, which is the same rule lib/types.ts keeps.
 */

const VRAM_TIERS = [6, 8, 12, 16, 24, 32, 48, 80];
const CONTEXTS = [4096, 8192, 32768, 131072];

// A student's laptop, not a workstation. The frontier chart is deliberately independent of
// this control, so an 8 GB default shows what each tier would buy rather than an empty table.
const DEFAULT_VRAM = 8;
const DEFAULT_CONTEXT = 8192;
const DEFAULT_QUANT: Quantisation = "Q4_K_M";

function formatContext(tokens: number): string {
  return tokens >= 1024 ? `${tokens / 1024}k` : String(tokens);
}

function billions(count: number): string {
  return (count / 1e9).toFixed(count >= 1e11 ? 0 : 1);
}

export function LocalExplorer({
  models,
  config,
  ceiling,
}: {
  models: LocalModel[];
  config: VramConfig;
  /** Highest Arena rating that exists at all, for the "you don't run this one" line. */
  ceiling: { model_name: string; arena_rating: number } | null;
}) {
  const t = useTranslations("local");

  const [vram, setVram] = useState(DEFAULT_VRAM);
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [quant, setQuant] = useState<Quantisation>(DEFAULT_QUANT);
  const [selected, setSelected] = useState<string | null>(null);

  // Read the URL once on mount rather than during render: the page is prerendered at build
  // time, and reading location during render would make the server and client disagree.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = Number(params.get("vram"));
    const ctx = Number(params.get("ctx"));
    const q = params.get("quant");
    if (Number.isFinite(fromUrl) && fromUrl > 0) setVram(fromUrl);
    if (Number.isFinite(ctx) && ctx > 0) setContext(ctx);
    if (q && (QUANTISATIONS as string[]).includes(q)) setQuant(q as Quantisation);
  }, []);

  // The link is the point: a configuration someone can paste into a chat.
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("vram", String(vram));
    params.set("ctx", String(context));
    params.set("quant", quant);
    window.history.replaceState(null, "", `?${params}`);
  }, [vram, context, quant]);

  const rows = useMemo(() => {
    const vramBytes = vram * GIB;
    return models
      .map((model) => ({ model, result: estimate(model, quant, context, vramBytes, config) }))
      .sort((a, b) => {
        // Best score first among the ones that run; everything else after, by size.
        const order = { fits: 0, tight: 1, offload: 2, no_fit: 3, unknown: 4 };
        const byVerdict = order[a.result.verdict] - order[b.result.verdict];
        if (byVerdict !== 0) return byVerdict;
        // arena_rating, not score: composites and ratings are different scales.
        return b.model.arena_rating - a.model.arena_rating;
      });
  }, [models, quant, context, vram, config]);

  const frontierRows = useMemo(
    () => frontier(models, VRAM_TIERS, quant, context, config),
    [models, quant, context, config],
  );

  const fitting = rows.filter(
    (row) => row.result.verdict === "fits" || row.result.verdict === "tight",
  ).length;

  const chosen = rows.find((row) => row.model.key === selected) ?? null;

  return (
    <>
      <Controls
        vram={vram}
        context={context}
        quant={quant}
        onVram={setVram}
        onContext={setContext}
        onQuant={setQuant}
      />

      {config.overhead_status !== "measured" && (
        <p
          className="mt-4 border-l-2 py-2 pl-3 text-[13px]"
          style={{ borderColor: "var(--amber)" }}
        >
          {t("overheadWarning")}
        </p>
      )}

      <FrontierChart rows={frontierRows} vram={vram} ceiling={ceiling} />

      <section className="mt-10" aria-live="polite">
        <h3
          className="border-b rule pb-2 text-[20px] leading-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("tableTitle")}
        </h3>
        <p className="num mt-2 text-[12px]" style={{ color: "var(--muted)" }}>
          {t("tableIntro", {
            fits: fitting,
            total: rows.length,
            vram,
            context: formatContext(context),
            quant,
          })}
        </p>

        {rows.length === 0 ? (
          <p className="mt-3 text-[13px]" style={{ color: "var(--muted)" }}>
            {t("noResults")}
          </p>
        ) : (
          <ResultsTable rows={rows} selected={selected} onSelect={setSelected} />
        )}
      </section>

      {chosen && <FormulaPanel row={chosen} context={context} vram={vram} />}

      <p className="mt-8 text-[12px]" style={{ color: "var(--muted)" }}>
        {t("sources")}
      </p>
    </>
  );
}

function Controls({
  vram,
  context,
  quant,
  onVram,
  onContext,
  onQuant,
}: {
  vram: number;
  context: number;
  quant: Quantisation;
  onVram: (value: number) => void;
  onContext: (value: number) => void;
  onQuant: (value: Quantisation) => void;
}) {
  const t = useTranslations("local");

  return (
    <div className="mt-6 flex flex-col gap-4">
      <Choices
        legend={t("vram")}
        options={VRAM_TIERS.map((tier) => ({ value: tier, label: `${tier} GB` }))}
        value={vram}
        onChange={onVram}
      />
      <Choices
        legend={t("context")}
        options={CONTEXTS.map((tokens) => ({
          value: tokens,
          label: formatContext(tokens),
        }))}
        value={context}
        onChange={onContext}
        note={t("contextNote")}
      />
      <Choices
        legend={t("quant")}
        options={QUANTISATIONS.map((q) => ({ value: q, label: q }))}
        value={quant}
        onChange={onQuant}
      />
    </div>
  );
}

/**
 * A radio group, not a row of buttons.
 *
 * fieldset/legend gives the set an accessible name, and native radios give arrow-key
 * movement and a single tab stop for free. Reimplementing that with buttons is how a
 * control ends up keyboard-hostile.
 */
function Choices<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  note,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  note?: string;
}) {
  const name = legend.replace(/\s+/g, "-").toLowerCase();

  return (
    <fieldset>
      <legend className="eyebrow mb-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <label
              key={String(option.value)}
              className="num cursor-pointer border px-3 py-1 text-[13px]"
              style={{
                borderColor: active ? "var(--amber)" : "var(--rule)",
                background: active ? "var(--amber-soft)" : "transparent",
                color: active ? "var(--amber)" : "inherit",
              }}
            >
              <input
                type="radio"
                name={name}
                value={String(option.value)}
                checked={active}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      {note && (
        <p className="mt-2 max-w-[42rem] text-[12px]" style={{ color: "var(--muted)" }}>
          {note}
        </p>
      )}
    </fieldset>
  );
}

/**
 * The frontier: the best model that fits at each VRAM tier.
 *
 * Primary rather than secondary, and independent of the VRAM control, because with 8 GB
 * selected the filtered table is thin and the interesting information is what the next tier
 * up would buy. Hand-drawn SVG; Sparkline.tsx already showed a chart library is not needed.
 */
function FrontierChart({
  rows,
  vram,
  ceiling,
}: {
  rows: { tier: number; model: LocalModel | null; estimate: Estimate | null }[];
  vram: number;
  ceiling: { model_name: string; arena_rating: number } | null;
}) {
  const t = useTranslations("local");

  const ratings = rows.map((row) => row.model?.arena_rating ?? 0).filter((v) => v > 0);
  const ceilingRating = ceiling?.arena_rating ?? null;
  const top = Math.max(...ratings, ceilingRating ?? 0);
  const bottom = Math.min(...ratings);
  if (!ratings.length) return null;

  const width = 720;
  const height = 240;
  const padLeft = 8;
  const padBottom = 46;
  const padTop = 28;
  const step = (width - padLeft) / rows.length;
  const span = Math.max(1, top - bottom);
  const y = (rating: number) =>
    padTop + (1 - (rating - bottom) / span) * (height - padTop - padBottom);

  return (
    <section className="mt-10">
      <h3
        className="border-b rule pb-2 text-[20px] leading-tight"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("frontierTitle")}
      </h3>
      <p className="mt-2 max-w-[46rem] text-[13px]" style={{ color: "var(--muted)" }}>
        {t("frontierIntro")}
      </p>

      <div className="mt-4 overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          style={{ minWidth: "38rem", overflow: "visible" }}
          role="img"
          aria-label={t("frontierIntro")}
        >
          {ceilingRating !== null && (
            <>
              <line
                x1={padLeft}
                x2={width}
                y1={y(ceilingRating)}
                y2={y(ceilingRating)}
                stroke="var(--muted)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              <text
                x={padLeft}
                y={y(ceilingRating) - 6}
                fontSize="11"
                fill="var(--muted)"
                className="num"
              >
                {t("ceiling")}
              </text>
            </>
          )}

          {rows.map((row, index) => {
            const x = padLeft + index * step;
            const isYours = row.tier === vram;
            if (!row.model) {
              return (
                <g key={row.tier}>
                  <text
                    x={x + step / 2}
                    y={height - padBottom - 8}
                    fontSize="10"
                    textAnchor="middle"
                    fill="var(--muted)"
                    className="num"
                  >
                    {t("frontierNone")}
                  </text>
                  <TierLabel x={x + step / 2} height={height} tier={row.tier} isYours={isYours} />
                </g>
              );
            }
            const top_ = y(row.model.arena_rating);
            return (
              <g key={row.tier}>
                {/* A step, not a point: the value holds across the whole tier. */}
                <line
                  x1={x + 3}
                  x2={x + step - 3}
                  y1={top_}
                  y2={top_}
                  stroke="var(--mark)"
                  strokeWidth={isYours ? 3 : 2}
                />
                <line
                  x1={x + step / 2}
                  x2={x + step / 2}
                  y1={top_}
                  y2={height - padBottom}
                  stroke="var(--rule)"
                  strokeWidth="1"
                />
                <text
                  x={x + step / 2}
                  y={top_ - 7}
                  fontSize="10"
                  textAnchor="middle"
                  fill="var(--muted)"
                  className="num"
                >
                  {row.model.arena_rating.toFixed(0)}
                </text>
                <TierLabel x={x + step / 2} height={height} tier={row.tier} isYours={isYours} />
                <text
                  x={x + step / 2}
                  y={height - padBottom + 30}
                  fontSize="9"
                  textAnchor="middle"
                  fill="var(--muted)"
                >
                  {row.model.key.slice(0, 18)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="mt-2 max-w-[46rem] text-[12px]" style={{ color: "var(--muted)" }}>
        {t("ceilingNote")}
      </p>

      {/* A real textual alternative, not an alt attribute: everything the chart shows,
          readable without seeing it. */}
      <details className="mt-3">
        <summary className="eyebrow cursor-pointer">{t("frontierAlt")}</summary>
        <table className="mt-2 w-full border-collapse text-left">
          <thead>
            <tr className="border-b rule">
              <th scope="col" className="py-2 pr-3">
                <span className="eyebrow">{t("frontierTier")}</span>
              </th>
              <th scope="col" className="py-2 pr-3">
                <span className="eyebrow">{t("frontierModel")}</span>
              </th>
              <th scope="col" className="py-2 text-right">
                <span className="eyebrow">{t("frontierScore")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.tier} className="border-b rule">
                <th scope="row" className="num py-2 pr-3 text-[13px] font-normal">
                  {row.tier} GB{row.tier === vram ? ` · ${t("yourCard")}` : ""}
                </th>
                <td className="py-2 pr-3 text-[13px]">
                  {row.model?.display_name ?? t("frontierNone")}
                </td>
                <td className="num py-2 text-right text-[13px]">
                  {row.model ? row.model.arena_rating.toFixed(0) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

function TierLabel({
  x,
  height,
  tier,
  isYours,
}: {
  x: number;
  height: number;
  tier: number;
  isYours: boolean;
}) {
  const t = useTranslations("local");
  return (
    <>
      <text
        x={x}
        y={height - 22}
        fontSize="11"
        textAnchor="middle"
        fill={isYours ? "var(--amber)" : "var(--muted)"}
        className="num"
      >
        {tier} GB
      </text>
      {isYours && (
        <text
          x={x}
          y={height - 8}
          fontSize="9"
          textAnchor="middle"
          fill="var(--amber)"
          className="num"
        >
          ▲ {t("yourCard")}
        </text>
      )}
    </>
  );
}

function ResultsTable({
  rows,
  selected,
  onSelect,
}: {
  rows: { model: LocalModel; result: Estimate }[];
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const t = useTranslations("local");
  const muted = { color: "var(--muted)" } as const;

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-left" style={{ minWidth: "52rem" }}>
        <thead>
          <tr className="border-b rule">
            {["model", "params", "weights", "kv", "total", "verdict", "score", "license"].map(
              (column) => (
                <th
                  key={column}
                  scope="col"
                  className={`py-2 pr-3 ${
                    ["weights", "kv", "total"].includes(column) ? "text-right" : ""
                  }`}
                >
                  <span className="eyebrow">{t(column)}</span>
                </th>
              ),
            )}
            <th scope="col" className="py-2">
              <span className="eyebrow">{t("how")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ model, result }) => (
            <tr
              key={model.key}
              className="border-b rule"
              style={{
                background: model.key === selected ? "var(--paper-sunk)" : undefined,
              }}
            >
              <th scope="row" className="py-2 pr-3 text-[13px] font-normal">
                <button
                  type="button"
                  onClick={() => onSelect(model.key === selected ? null : model.key)}
                  className="text-left underline underline-offset-2"
                  aria-label={t("selectRow", { model: model.display_name })}
                  aria-expanded={model.key === selected}
                >
                  {model.display_name}
                </button>
                {model.architecture === "moe" && (
                  <span
                    className="num ml-2 text-[10px]"
                    style={muted}
                    title={t("moeNote", {
                      total: billions(model.params_total),
                      active: model.n_experts_active
                        ? billions(
                            (model.params_total / (model.n_experts || 1)) *
                              model.n_experts_active,
                          )
                        : "?",
                    })}
                  >
                    {t("moe")}
                  </span>
                )}
              </th>
              <td className="num py-2 pr-3 text-[12px]" style={muted}>
                {billions(model.params_total)}B
              </td>
              <td className="num py-2 pr-3 text-right text-[13px]">
                {formatGiB(result.weights)}
                {!result.weightsMeasured && (
                  <span
                    className="ml-1 text-[10px]"
                    style={muted}
                    title={t("estimatedNote")}
                  >
                    ~
                  </span>
                )}
              </td>
              <td className="num py-2 pr-3 text-right text-[13px]" style={muted}>
                {result.kv === null ? "—" : formatGiB(result.kv)}
              </td>
              <td className="num py-2 pr-3 text-right text-[13px]">
                {result.total === null ? "—" : formatGiB(result.total)}
              </td>
              <td className="py-2 pr-3 text-[12px]">
                {/* Text, never colour alone. */}
                <span
                  style={{
                    color:
                      result.verdict === "fits"
                        ? "var(--amber)"
                        : result.verdict === "no_fit" || result.verdict === "unknown"
                          ? "var(--muted)"
                          : "inherit",
                  }}
                  title={
                    result.verdict === "offload"
                      ? t("offloadNote", {
                          percent: Math.round(result.offloadFraction * 100),
                        })
                      : t(`${result.verdict}Note`)
                  }
                >
                  {t(result.verdict)}
                </span>
              </td>
              <td className="num py-2 pr-3 text-[12px]">
                {model.score.value.toFixed(model.score.kind === "composite" ? 1 : 0)}
                <span className="block text-[10px]" style={muted}>
                  {model.score.kind === "composite"
                    ? t("scoreComposite", { coverage: model.score.coverage })
                    : t("scoreArena")}
                </span>
              </td>
              <td className="py-2 pr-3 text-[11px]" style={muted}>
                {model.license ?? "—"}
              </td>
              <td className="py-2 text-[11px]">
                <a
                  href={`https://huggingface.co/${model.hf_repo}`}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="underline underline-offset-2"
                  style={{ color: "var(--amber)" }}
                >
                  {model.hf_repo.split("/")[0]}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The formula with this row's own numbers, on the page rather than in /methodology. */
function FormulaPanel({
  row,
  context,
  vram,
}: {
  row: { model: LocalModel; result: Estimate };
  context: number;
  vram: number;
}) {
  const t = useTranslations("local");
  const { model, result } = row;

  return (
    <section
      className="mt-6 border-l-2 py-3 pl-4"
      style={{ borderColor: "var(--amber)" }}
    >
      <h4 className="eyebrow mb-2">{t("formulaTitle")}</h4>
      <p className="num text-[13px]">{t("formula")}</p>
      <ul className="num mt-2 flex flex-col gap-1 text-[12px]" style={{ color: "var(--muted)" }}>
        <li>
          {t("formulaWeights", {
            weights: formatGiB(result.weights, 2),
            source: result.weightsMeasured ? t("measured") : t("estimated"),
          })}
        </li>
        {result.kv !== null && model.n_layers && model.n_kv_heads && model.head_dim && (
          <li>
            {t("formulaKv", {
              layers: model.n_layers,
              kvHeads: model.n_kv_heads,
              headDim: model.head_dim,
              context,
              kv: formatGiB(result.kv, 2),
            })}
          </li>
        )}
        <li>{t("formulaOverhead")}</li>
        {result.total !== null && (
          <li style={{ color: "inherit" }}>
            {t("formulaTotal", { total: formatGiB(result.total, 2), vram })}
          </li>
        )}
      </ul>
      <p className="num mt-3 text-[12px]">
        <code>ollama pull {model.key}</code>
      </p>
    </section>
  );
}
