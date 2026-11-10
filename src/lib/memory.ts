/**
 * Call memory, persisted in localStorage (browser only).
 * A real deployment would store this per seller in a backend/CRM.
 */
import { estimateRecovery } from "@/lib/diagnose";
import type { CallRecord } from "@/lib/types";

const KEY = "priya.callHistory.v1";
const MAX_CALLS = 10;

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadHistory(): CallRecord[] {
  const s = safeStorage();
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CallRecord[]) : [];
  } catch {
    return [];
  }
}

export function loadLastCall(): CallRecord | null {
  return loadHistory()[0] ?? null;
}

export function saveCall(record: CallRecord): void {
  const s = safeStorage();
  if (!s) return;
  try {
    const history = [record, ...loadHistory().filter((r) => r.id !== record.id)].slice(0, MAX_CALLS);
    s.setItem(KEY, JSON.stringify(history));
  } catch {
    // Storage full or blocked: memory is a nice-to-have, never break the call.
  }
}

export function resetMemory(): void {
  try {
    safeStorage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Built-in sample "last call" so Follow-up mode can be demoed even on a
 * fresh browser. Clearly flagged as sample in the UI.
 */
export function sampleMemory(now = new Date()): CallRecord {
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d.toISOString();
  };
  const date = (n: number) => daysAgo(-n).slice(0, 10);
  return {
    id: "sample",
    sample: true,
    date: daysAgo(6),
    mode: "inbound",
    insights: [
      { id: "s1", topic: "supplier", detail: "Main supplier in Delhi delayed shipments; promised restock of cookers, tawas and bedsheets by the 20th", at: daysAgo(6) },
      { id: "s2", topic: "priorities", detail: "Pressure cooker and Jaipuri bedsheets are the seller's most important products", at: daysAgo(6) },
      { id: "s3", topic: "inventory", detail: "Brass diyas and jute baskets won't be restocked for at least a month", at: daysAgo(6) },
    ],
    actions: [
      { id: "a1", title: "Restock top sellers first", why: "Biggest revenue loss", expected_recovery_inr: estimateRecovery("generate_restock_list").expected_recovery_inr, owner: "seller", due_date: date(-1), status: "executed", action_type: "generate_restock_list", execution_result: "Restock list ready: 12 SKUs" },
      { id: "a2", title: "Pause listings that can't be restocked soon", why: "Stop 'item unavailable' cancellations", expected_recovery_inr: estimateRecovery("pause_unrestockable_listings").expected_recovery_inr, owner: "kam", due_date: date(-6), status: "executed", action_type: "pause_unrestockable_listings", execution_result: "2 listings paused" },
      { id: "a3", title: "Join weekend deal once stock is back", why: "Rebuild ranking", expected_recovery_inr: estimateRecovery("enroll_in_deal").expected_recovery_inr, owner: "seller", due_date: date(2), status: "proposed", action_type: "enroll_in_deal" },
    ],
    follow_up: { date: date(0), purpose: "Check restock arrival and cancellation rate" },
    summary: null,
  };
}
