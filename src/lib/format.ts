/** Formatting helpers (Indian number system). */

const inrFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** 135000 → "₹1,35,000" */
export function formatInr(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}₹${inrFormatter.format(Math.abs(Math.round(value)))}`;
}

/** 135000 → "₹1.35L", 47117 → "₹47.1k", 800 → "₹800" */
export function formatInrShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000, 2)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000, 1)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

function trim(n: number, digits: number): string {
  return Number(n.toFixed(digits)).toString();
}

/** 0.14 → "14%" */
export function formatPct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Percentage change between two numbers, e.g. (400, 270) → -32.5 */
export function pctChange(from: number, to: number): number {
  if (from === 0) return 0;
  return Math.round(((to - from) / from) * 1000) / 10;
}

/** Round to the nearest `step` (e.g. ₹500) so estimates don't look falsely precise. */
export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Short unique id, safe in both browser and Node. */
export function uid(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}
