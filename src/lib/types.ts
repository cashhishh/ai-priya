/**
 * Shared domain types used by the diagnosis engine, the tool executor
 * (client in Live mode, server in Fallback mode) and the UI.
 */

export type CallMode = "inbound" | "proactive" | "follow_up";
export type VoiceEngine = "live" | "fallback";

export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "data" | "inference";

export interface Issue {
  id: "inventory" | "visibility" | "promotions" | "cancellations";
  title: string;
  severity: Severity;
  /** One-line plain-English explanation. */
  summary: string;
  /** Concrete numbers backing the finding. */
  evidence: string[];
  estimated_monthly_impact_inr: number;
  confidence: Confidence;
}

export interface Diagnosis {
  headline: {
    sales_change_inr: number;
    sales_change_pct: number;
    orders_change_pct: number;
    asp_change_pct: number;
    driver: "volume";
    statement: string;
  };
  /** Causes the data rules OUT — saying so is part of a good diagnosis. */
  ruled_out: { cause: string; reason: string }[];
  /** Sorted by estimated ₹ impact, biggest first. */
  issues: Issue[];
  note: string;
}

export type ActionType =
  | "generate_restock_list"
  | "pause_unrestockable_listings"
  | "enable_stock_alerts"
  | "enroll_in_deal"
  | "reactivate_listings_on_restock"
  | "targeted_sku_deal";

export const ACTION_TYPES: ActionType[] = [
  "generate_restock_list",
  "pause_unrestockable_listings",
  "enable_stock_alerts",
  "enroll_in_deal",
  "reactivate_listings_on_restock",
  "targeted_sku_deal",
];

export type InsightTopic =
  | "inventory"
  | "supplier"
  | "cancellations"
  | "pricing"
  | "competition"
  | "promotions"
  | "priorities"
  | "other";

export interface SellerInsight {
  id: string;
  topic: InsightTopic;
  detail: string;
  at: string; // ISO
}

export type ActionOwner = "seller" | "kam";
export type ActionStatus = "proposed" | "executed";

export interface ActionItem {
  id: string;
  title: string;
  why: string;
  expected_recovery_inr: number;
  owner: ActionOwner;
  due_date: string;
  status: ActionStatus;
  /** Links a proposal to an executable mock action, if any. */
  action_type?: ActionType;
  /** Human-readable confirmation once executed. */
  execution_result?: string;
  /** Extra detail lines (e.g. restock list) once executed. */
  execution_lines?: string[];
}

export interface FollowUp {
  date: string;
  purpose: string;
}

export interface CallSummary {
  issues: string[];
  actions: string[];
  next_steps: string[];
  whatsapp_text: string;
  whatsapp_url: string;
  created_at: string;
  /** true when built locally because the call ended before Priya summarised. */
  auto_generated?: boolean;
}

export interface Escalation {
  reason: string;
  ticket_id: string;
  at: string;
}

export interface ProgressSnapshot {
  label: string;
  out_of_stock_products: { at_last_call: number; now: number };
  cancellation_rate_last_7_days: { at_last_call: number; now: number };
  orders_last_7_days: { at_last_call: number; now: number };
  explanation: string;
}

/** One past call persisted in localStorage. */
export interface CallRecord {
  id: string;
  date: string; // ISO
  mode: CallMode;
  insights: SellerInsight[];
  actions: ActionItem[];
  follow_up: FollowUp | null;
  summary: CallSummary | null;
  /** true for the built-in sample used when no real memory exists. */
  sample?: boolean;
}

/**
 * Typed UI events. Every tool call emits zero or more of these; the UI reducer
 * (and the server-side context in Fallback mode) consume them.
 */
export type UiEvent =
  | { type: "metrics_viewed"; progress: ProgressSnapshot | null }
  | { type: "diagnosis"; diagnosis: Diagnosis }
  | { type: "products_viewed"; filter: ProductFilter; count: number }
  | { type: "insight_recorded"; insight: SellerInsight }
  | { type: "action_proposed"; action: ActionItem }
  | {
      type: "action_executed";
      action_type: ActionType;
      result: string;
      lines: string[];
      /** Used if no matching proposal exists yet. */
      fallback_action: ActionItem;
    }
  | { type: "follow_up_scheduled"; follow_up: FollowUp }
  | { type: "escalated"; escalation: Escalation }
  | { type: "summary_ready"; summary: CallSummary }
  /** The seller said no to (or didn't clearly accept) an offer to do this action now. */
  | { type: "offer_declined"; action_type: ActionType };

export type ProductFilter = "out_of_stock" | "top_sellers" | "all";

/** Readable record of one tool call for the "Agent Brain" timeline. */
export interface ToolTrace {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** "blocked" = a code guardrail refused the call and told the model why. */
  status: "running" | "done" | "error" | "blocked" | "cancelled";
  result_line?: string;
  started_at: number;
  duration_ms?: number;
}

/** What the tool executor needs to know about the call so far. */
export interface CallContext {
  mode: CallMode;
  insights: SellerInsight[];
  actions: ActionItem[];
  follow_up: FollowUp | null;
  memory: CallRecord | null;
  now_iso: string;
  /** run_diagnosis has been called in this call. */
  diagnosed?: boolean;
  /** The call was escalated to a human KAM (relaxes wrap-up guards). */
  escalated?: boolean;
  /** Offers the seller declined or didn't clearly accept; don't push them again. */
  declined_offers?: ActionType[];
  /** Who said what, when: derived from the live transcript (see tools/signals.ts). */
  signals?: ConversationSignals;
}

/** Turn-taking facts the wrap-up guard needs (timestamps in ms). */
export interface ConversationSignals {
  /** Priya last asked the seller any question (a "?" in her words). */
  priya_question_at?: number;
  /** Priya last asked "kuch aur help chahiye?" (or similar). */
  help_asked_at?: number;
  /** The seller last said something. */
  seller_spoke_at?: number;
  /** The seller's latest words (for goodbye detection). */
  last_seller_text?: string;
  /** Tail of what Priya said since the seller last spoke (for phrase detection across chunks). */
  priya_tail?: string;
}
