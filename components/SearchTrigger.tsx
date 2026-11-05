"use client";

/**
 * A large search field for the hero. It owns no dialog: it re-sends the shortcut the one
 * CommandPalette in the header already listens for, so there is a single palette and a
 * single index request, however many entry points the page offers.
 */
export function SearchTrigger({ label, hint }: { label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
      }
      aria-keyshortcuts="Control+K Meta+K"
      className="flex min-h-12 w-full max-w-[34rem] items-center justify-between gap-3 rounded-control border border-line bg-surface px-4 text-left text-md text-tertiary transition-colors hover:text-primary"
    >
      <span>{label}</span>
      <kbd aria-hidden="true" className="num hidden text-xs sm:inline">
        {hint}
      </kbd>
    </button>
  );
}
