"use client";

import { useTranslations } from "next-intl";
import { nearestStop } from "@/lib/local-view";
import { parseNumber } from "./form";

/**
 * A slider that rests on memory sizes that exist, paired with a box for the exact figure.
 * The box is the source of truth: typing 11 keeps 11 while the thumb sits on the closest
 * rung, so a machine with an unusual amount of memory is never rounded to a shelf size.
 */
export function StopSlider({
  id,
  label,
  stops,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  stops: readonly number[];
  value: string;
  onChange: (value: string) => void;
  hint?: string | null;
}) {
  const t = useTranslations("local.hardware");
  const parsed = parseNumber(value);
  const index = nearestStop(stops, parsed ?? stops[0]);

  return (
    <div className="flex min-w-[14rem] flex-1 flex-col gap-1">
      <div className="flex items-end justify-between gap-3">
        <label htmlFor={id} className="eyebrow">
          {label}
        </label>
        <span className="flex items-baseline gap-1">
          <input
            id={`${id}-exact`}
            inputMode="decimal"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={t("exact", { label })}
            className="num min-h-11 w-16 rounded-control bg-sunk px-2 py-1 text-right text-md font-semibold outline-none sm:min-h-8"
          />
          <span className="text-xs text-tertiary">GB</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        onChange={(event) => onChange(String(stops[Number(event.target.value)]))}
        aria-valuetext={`${parsed ?? stops[index]} GB`}
        className="rig-range"
      />
      <div className="num flex justify-between text-2xs text-tertiary" aria-hidden="true">
        <span>{stops[0]}</span>
        <span>{stops[stops.length - 1]}</span>
      </div>
      {hint && <p className="text-2xs text-tertiary">{hint}</p>}
    </div>
  );
}
