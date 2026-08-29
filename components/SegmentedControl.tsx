"use client";

import { useRef } from "react";
import clsx from "clsx";

/**
 * Apple's segmented control: a `role="radiogroup"` of mutually-exclusive options with a
 * single thumb that slides to the selected one. Roving tabindex, so Tab reaches the group
 * once and the arrow keys move both selection and focus together — the standard behavior
 * for a native-feeling radio group, not a tab list.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const count = options.length;

  function move(from: number, delta: number) {
    const next = (from + delta + count) % count;
    onChange(options[next].value);
    buttonRefs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="relative inline-flex min-h-11 gap-0.5 rounded-control bg-sunk p-nested sm:min-h-8"
    >
      <span
        aria-hidden="true"
        className="segmented-thumb pointer-events-none absolute rounded-inner"
        style={{
          top: "var(--inset-nested)",
          bottom: "var(--inset-nested)",
          left: "var(--inset-nested)",
          width: `calc((100% - 2 * var(--inset-nested)) / ${count})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                event.preventDefault();
                move(i, 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                move(i, -1);
              }
            }}
            className={clsx(
              "segmented-option relative z-10 flex-1 rounded-inner px-2 text-center text-sm",
              active ? "font-semibold text-primary" : "text-tertiary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
