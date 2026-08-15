"use client";

import { useEffect, useRef } from "react";

export function Drawer({
  open,
  onClose,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Focus the close button when the drawer opens.
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  // Trap focus inside the panel and close on Escape.
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[var(--z-drawer)] bg-[rgb(0_0_0/0.3)]"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="fixed right-0 top-0 z-[var(--z-drawer)] flex h-full w-full max-w-[26rem] flex-col overflow-y-auto border-l"
        style={{
          background: "var(--surface-overlay)",
          borderColor: "var(--line-subtle)",
          boxShadow: "var(--elevation-overlay)",
        }}
      >
        <div className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--line-subtle)" }}>
          <span className="eyebrow">{label}</span>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="eyebrow row-shift p-1"
            style={{ color: "var(--text-tertiary)" }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}
