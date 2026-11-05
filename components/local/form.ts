/**
 * The machine as the person typed it: strings, so a half-typed "1" is not coerced mid-edit,
 * turned into a `Hardware` only when every number the chosen layout needs is valid.
 * No React and no Node imports.
 */
import type { Hardware } from "@/lib/fit";

export type Kind = "discrete" | "unified" | "cpu";

export type Form = {
  kind: Kind;
  preset: string;
  /** GPU memory for a discrete card, or the shared pool on unified memory. */
  memory: string;
  ram: string;
  bandwidth: string;
  context: string;
};

/**
 * A CPU-only machine with 16 GB: computable on first paint and naming no GPU, so the page
 * opens on a result without nudging anyone toward a brand's hardware.
 */
export const DEFAULT_FORM: Form = {
  kind: "cpu",
  preset: "custom",
  memory: "",
  ram: "16",
  bandwidth: "",
  context: "8192",
};

export const CONTEXTS = ["4096", "8192", "16384", "32768", "131072"];
export const STORAGE_KEY = "modelhub.local.hardware.v1";
/** llmfit holds back this share of installed RAM for the system when it is told the total. */
export const RAM_USABLE = 0.9;

export function parseNumber(value: string): number | null {
  const n = Number(value.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null;
}

export function toHardware(form: Form): Hardware | null {
  const memory = parseNumber(form.memory);
  const ram = parseNumber(form.ram);
  const bandwidth = parseNumber(form.bandwidth);
  if (form.kind === "cpu") return ram ? { kind: "cpu", ramGb: ram * RAM_USABLE } : null;
  if (form.kind === "unified") {
    return memory ? { kind: "unified", poolGb: memory, bandwidthGbps: bandwidth } : null;
  }
  return memory && ram
    ? { kind: "discrete", vramGb: memory, ramGb: ram * RAM_USABLE, bandwidthGbps: bandwidth }
    : null;
}

/**
 * The same machine with a different amount of the memory that decides what fits: the GPU's
 * (or the shared pool) when there is one, system RAM when there is not. Used by the ladder.
 */
export function withMemory(form: Form, gb: number): Hardware | null {
  return toHardware(
    form.kind === "cpu" ? { ...form, ram: String(gb) } : { ...form, memory: String(gb) },
  );
}

export function readStored(): Form | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const v = value as Record<string, unknown>;
    const kinds: Kind[] = ["discrete", "unified", "cpu"];
    if (!kinds.includes(v.kind as Kind)) return null;
    for (const key of ["preset", "memory", "ram", "bandwidth", "context"]) {
      if (typeof v[key] !== "string" || (v[key] as string).length > 24) return null;
    }
    if (!CONTEXTS.includes(v.context as string)) return null;
    return v as unknown as Form;
  } catch {
    return null;
  }
}

export function fmt(n: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
}

/** 7.6e9 -> "7.6B", 685e9 -> "685B", 751e6 -> "0.75B". Billions, as model names write them. */
export function billions(parameters: number, locale: string): string {
  const b = parameters / 1e9;
  return `${fmt(b, locale, b < 10 ? 2 : b < 100 ? 1 : 0)}B`;
}
