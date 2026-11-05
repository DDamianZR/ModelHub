"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useRouter } from "@/i18n/navigation";
import type { SearchEntry } from "@/lib/types";

type Labels = {
  trigger: string;
  placeholder: string;
  title: string;
  empty: string;
  loading: string;
  failed: string;
  hint: string;
  model: string;
  provider: string;
  benchmark: string;
};

const MAX_RESULTS = 12;

/** One request per page load, shared by every open of the palette. */
let indexPromise: Promise<SearchEntry[]> | null = null;
function loadIndex(): Promise<SearchEntry[]> {
  if (!indexPromise) {
    indexPromise = fetch("/search-index.json")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<SearchEntry[]>;
      })
      .catch((error) => {
        indexPromise = null; // let the next open try again
        throw error;
      });
  }
  return indexPromise;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * ⌘K / Ctrl+K search over a static index of models, providers and benchmarks. The index is
 * a build-time file, fetched on first open, so the palette adds nothing to the initial
 * payload and needs no server. Results keep the index order (rank order for models), so
 * nothing is promoted: every token of the query must appear in the name or its subtitle.
 */
export function CommandPalette({ labels }: { labels: Labels }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    setQuery("");
    setActive(0);
    dialog.showModal();
    inputRef.current?.focus();
    setFailed(false);
    loadIndex().then(setIndex, () => setFailed(true));
  }, []);

  const close = useCallback(() => dialogRef.current?.close(), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (dialogRef.current?.open) close();
        else open();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const results = useMemo(() => {
    if (!index) return [];
    const tokens = fold(query).split(/\s+/).filter(Boolean);
    const matches =
      tokens.length === 0
        ? index.filter((entry) => entry.t === "model")
        : index.filter((entry) => {
            const hay = fold(`${entry.n} ${entry.s ?? ""}`);
            return tokens.every((token) => hay.includes(token));
          });
    return matches.slice(0, MAX_RESULTS);
  }, [index, query]);

  function go(entry: SearchEntry) {
    close();
    const base = entry.t === "model" ? "/model" : entry.t === "provider" ? "/provider" : "/benchmark";
    router.push(`${base}/${entry.id}`);
  }

  const kindLabel = (entry: SearchEntry) => labels[entry.t];
  const activeId = results[active] ? `palette-opt-${active}` : undefined;

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={labels.trigger}
        aria-keyshortcuts="Control+K Meta+K"
        className="control control-sm eyebrow shrink-0 gap-2"
      >
        <span>{labels.trigger}</span>
        <kbd className="num hidden text-2xs text-tertiary sm:inline">⌘K</kbd>
      </button>

      <dialog
        ref={dialogRef}
        aria-label={labels.title}
        onClick={(event) => {
          // A click on the backdrop lands on the dialog element itself.
          if (event.target === dialogRef.current) close();
        }}
        className="palette m-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-overlay border border-line bg-overlay p-0 text-primary"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (event.key === "Enter" && results[active]) {
              event.preventDefault();
              go(results[active]);
            }
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={labels.placeholder}
          placeholder={labels.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="block min-h-11 w-full border-b border-subtle bg-transparent px-4 text-base outline-none"
        />

        <ul id="palette-list" role="listbox" aria-label={labels.title} className="max-h-[50vh] overflow-y-auto p-1">
          {!index && !failed && (
            <li className="px-3 py-6 text-center text-sm text-tertiary">{labels.loading}</li>
          )}
          {failed && <li className="px-3 py-6 text-center text-sm text-tertiary">{labels.failed}</li>}
          {index && results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-tertiary">{labels.empty}</li>
          )}
          {results.map((entry, i) => (
            <li
              key={`${entry.t}:${entry.id}`}
              id={`palette-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => go(entry)}
              className={clsx(
                "flex min-h-9 cursor-pointer items-center justify-between gap-3 rounded-control px-3 text-sm",
                i === active && "bg-raised",
              )}
            >
              <span className="min-w-0 truncate">
                {entry.n}
                {entry.s && entry.t === "model" && (
                  <span className="ml-2 text-tertiary">{entry.s}</span>
                )}
              </span>
              <span className="eyebrow shrink-0">{kindLabel(entry)}</span>
            </li>
          ))}
        </ul>
        <p className="border-t border-subtle px-4 py-2 text-2xs text-tertiary">{labels.hint}</p>
      </dialog>
    </>
  );
}
