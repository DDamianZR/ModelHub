import clsx from "clsx";
import type { ElementType, HTMLAttributes, ReactNode } from "react";

/**
 * The grouped card: iOS's basic unit of a data-heavy screen. `inset` marks a card whose
 * direct children are its own list of rows — it turns on the divider between them, styled
 * to sit inset from the card's own padding rather than as a border drawn on the card.
 */
export function Surface({
  as,
  inset = false,
  className,
  children,
  ...props
}: {
  as?: ElementType;
  inset?: boolean;
  className?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>) {
  const Tag = as ?? "div";
  return (
    <Tag className={clsx("surface", inset && "divide-y divide-subtle", className)} {...props}>
      {children}
    </Tag>
  );
}
