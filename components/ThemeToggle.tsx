"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

/**
 * Dark is the default; light is opt-in and remembered. The inline script in the locale
 * layout applies a stored choice before first paint, so this component only has to keep
 * the attribute and the storage in step. Storage can throw (private mode, blocked
 * cookies), and a failed write must not break the toggle.
 */
export function ThemeToggle({
  labels,
}: {
  labels: { toLight: string; toDark: string; light: string; dark: string };
}) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("mh-theme", next);
    } catch {
      /* the choice still applies for this visit */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? labels.toLight : labels.toDark}
      className="control control-sm eyebrow shrink-0"
    >
      {/* The icon and, from sm up, the text name the theme in use; the aria-label names
          the action. On a phone the icon alone keeps the wordmark from being clipped. */}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sm:hidden">
        {theme === "dark" ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
      <span className="hidden sm:inline">{theme === "dark" ? labels.dark : labels.light}</span>
    </button>
  );
}
