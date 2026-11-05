"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  parseLlmfitImport,
  type ImportError,
  type LlmfitImport,
} from "@/lib/llmfit-import";
import type { Form } from "./form";

type Hints = {
  gpu: "checking" | "none" | { name: string };
  memoryGb: "checking" | null | number;
};

/**
 * Everything optional about describing the machine: what the browser says about it, and a
 * way to paste what `llmfit recommend --json` printed. Collapsed by default, because the
 * page works from the controls above and nothing here is needed to read a result.
 */
export function AdvancedPanel({
  storage,
  onApply,
  onVerdicts,
}: {
  storage: "unknown" | "ok" | "off";
  onApply: (patch: Partial<Form>) => void;
  onVerdicts: (verdicts: LlmfitImport["verdicts"] | null) => void;
}) {
  const t = useTranslations("local");

  const [hints, setHints] = useState<Hints>({ gpu: "checking", memoryGb: "checking" });
  const [importText, setImportText] = useState("");
  const [imported, setImported] = useState<LlmfitImport | null>(null);
  const [importError, setImportError] = useState<ImportError | null>(null);
  const [applied, setApplied] = useState(false);

  // Hints only. Nothing reads `hints` except the list below; it is displayed and that is all.
  useEffect(() => {
    let cancelled = false;
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      gpu?: {
        requestAdapter(): Promise<{
          info?: { vendor?: string; architecture?: string; description?: string };
        } | null>;
      };
    };
    const memoryGb = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
    const finish = (gpu: Hints["gpu"]) => {
      if (!cancelled) setHints({ gpu, memoryGb });
    };
    if (!nav.gpu) {
      queueMicrotask(() => finish("none"));
    } else {
      nav.gpu
        .requestAdapter()
        .then((adapter) => {
          const info = adapter?.info;
          const name = [info?.vendor, info?.architecture || info?.description]
            .filter(Boolean)
            .join(" ");
          finish(name ? { name } : "none");
        })
        .catch(() => finish("none"));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  function readImport(text: string) {
    setImportText(text);
    setApplied(false);
    if (!text.trim()) {
      setImported(null);
      setImportError(null);
      onVerdicts(null);
      return;
    }
    const parsed = parseLlmfitImport(text);
    if ("error" in parsed) {
      setImported(null);
      setImportError(parsed.error);
      onVerdicts(null);
    } else {
      setImported(parsed);
      setImportError(null);
      onVerdicts(parsed.verdicts);
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      setImported(null);
      setImportError("too_large");
      onVerdicts(null);
      return;
    }
    readImport(await file.text());
  }

  function applyImport() {
    if (!imported) return;
    const hw = imported.hardware;
    const round = (n: number | null) => (n === null ? "" : String(Math.round(n * 10) / 10));
    if (!hw.hasGpu) {
      onApply({ kind: "cpu", preset: "custom", ram: round(hw.totalRamGb), memory: "", bandwidth: "" });
    } else if (hw.unified) {
      onApply({
        kind: "unified",
        preset: "custom",
        memory: round(hw.gpuMemoryGb ?? hw.totalRamGb),
        ram: round(hw.totalRamGb),
        bandwidth: round(hw.gpuBandwidthGbps),
      });
    } else {
      onApply({
        kind: "discrete",
        preset: "custom",
        memory: round(hw.gpuMemoryGb),
        ram: round(hw.totalRamGb),
        bandwidth: round(hw.gpuBandwidthGbps),
      });
    }
    setApplied(true);
  }

  return (
    <details className="group border-t border-subtle pt-3">
      <summary className="eyebrow min-h-11 cursor-pointer py-2 sm:min-h-8">
        {t("advanced.title")}
      </summary>

      <div className="mt-2 grid gap-6 lg:grid-cols-2" aria-live="polite">
        <div className="text-xs text-tertiary">
          <p className="eyebrow">{t("hints.title")}</p>
          <p className="mt-1">{t("hints.body")}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            <li>
              {hints.gpu === "checking"
                ? t("hints.checking")
                : hints.gpu === "none"
                  ? t("hints.noGpu")
                  : t("hints.gpu", { name: hints.gpu.name })}
            </li>
            <li>
              {hints.memoryGb === "checking"
                ? t("hints.checking")
                : hints.memoryGb === null
                  ? t("hints.noMemory")
                  : t("hints.memory", { gb: hints.memoryGb })}
            </li>
          </ul>
        </div>

        <div>
          <p className="eyebrow">{t("import.title")}</p>
          <p className="mt-1 text-xs text-tertiary">{t("import.body")}</p>
          <label htmlFor="local-import" className="eyebrow mt-2 block">
            {t("import.paste")}
          </label>
          <textarea
            id="local-import"
            value={importText}
            onChange={(event) => readImport(event.target.value)}
            rows={4}
            spellCheck={false}
            className="num mt-1 w-full rounded-control bg-sunk px-2 py-1 text-xs outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label htmlFor="local-import-file" className="eyebrow">
              {t("import.file")}
            </label>
            <input
              id="local-import-file"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void readFile(event.target.files?.[0])}
              className="text-xs"
            />
            <button
              type="button"
              disabled={!imported}
              onClick={applyImport}
              className="control eyebrow min-h-11 sm:min-h-8"
            >
              {t("import.apply")}
            </button>
            <button
              type="button"
              disabled={!importText}
              onClick={() => readImport("")}
              className="control eyebrow min-h-11 sm:min-h-8"
            >
              {t("import.clear")}
            </button>
          </div>
          <p className="mt-2 text-xs text-tertiary" role="status">
            {importError && t(`import.error_${importError}`)}
            {imported &&
              !importError &&
              (applied ? t("import.applied") : t("import.ok", { models: imported.verdicts.size }))}
          </p>
          <p className="mt-1 text-2xs text-tertiary">
            {storage === "off" ? t("import.storageOff") : t("import.stored")}
          </p>
        </div>
      </div>
    </details>
  );
}
