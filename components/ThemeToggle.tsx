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
      {/* The visible text names the theme in use; the aria-label names the action. */}
      {theme === "dark" ? labels.dark : labels.light}
    </button>
  );
}
