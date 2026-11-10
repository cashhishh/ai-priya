/**
 * End-of-call summary + WhatsApp-ready message (Hinglish-friendly).
 * The wa.me link has no phone number, so the seller/KAM picks the chat.
 * Nothing is sent automatically; the seller shares it themselves.
 *
 * Actions come from the call state (every proposed action with its status),
 * not from the model's free text, so the summary can't drop or invent any.
 */
import { SELLER_PROFILE } from "@/data/seller";
import { diagnose } from "@/lib/diagnose";
import { formatInrShort } from "@/lib/format";
import type { ActionItem, ActionType, CallSummary, FollowUp, Issue } from "@/lib/types";

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function prettyDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
}

/** "Restock top sellers: Seller, to do by 20 Nov (~₹35.5k/month)" */
export function formatActionLine(a: ActionItem): string {
  const who = a.owner === "kam" ? "Priya" : "Seller";
  const status = a.status === "executed" ? "done" : `to do by ${prettyDate(a.due_date)}`;
  const inr = a.expected_recovery_inr ? ` (~${formatInrShort(a.expected_recovery_inr)}/month)` : "";
  return `${a.title}: ${who}, ${status}${inr}`;
}

function issueLine(i: Issue): string {
  return `${i.title} (≈${formatInrShort(i.estimated_monthly_impact_inr)}/month)`;
}

/**
 * Keep the model's issue list, but guarantee at least `min` issues by topping
 * up from the diagnosis (biggest ₹ impact first, skipping near-duplicates).
 */
export function ensureIssues(issues: string[], diagnosisIssues: Issue[], min = 2): string[] {
  const out = issues.map((i) => i.trim()).filter(Boolean);
  for (const d of diagnosisIssues) {
    if (out.length >= min) break;
    const key = d.title.toLowerCase().split(" ").slice(0, 2).join(" ");
    if (!out.some((o) => o.toLowerCase().includes(key))) out.push(issueLine(d));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Simple Hinglish for the WhatsApp message (the modal keeps the English lines)
// ---------------------------------------------------------------------------

const HINGLISH_ACTIONS: Record<ActionType, string> = {
  generate_restock_list: "Top-selling products ka stock wapas mangwana",
  pause_unrestockable_listings: "Jo maal jaldi nahi aa sakta, uski listing pause karna",
  enable_stock_alerts: "Low-stock alert on karna",
  enroll_in_deal: "Stock aane ke baad deal mein judna",
  reactivate_listings_on_restock: "Stock aate hi listing wapas live karna",
  targeted_sku_deal: "Competitor wale product par sirf us product ka coupon",
};

/** Keyword → diagnosis issue id, so model phrasing maps onto one Hinglish line. */
const ISSUE_KEYS: [RegExp, string][] = [
  [/out[- ]of[- ]stock|stock-?out|stock khatam|restock|inventory/i, "inventory"],
  [/cancel/i, "cancellations"],
  [/visib|rank|search/i, "visibility"],
  [/\bdeals?\b|promo|\bads?\b|offer/i, "promotions"],
];

function hinglishIssueById(id: string, impact: number): string | null {
  const k = formatInrShort(impact);
  switch (id) {
    case "inventory":
      return `Top-selling products out of stock ho gaye (≈${k}/mahina ka nuksaan)`;
    case "cancellations":
      return `Cancellations 8% se 14% ho gaye, zyada tar "item unavailable" ki wajah se (≈${k}/mahina)`;
    case "visibility":
      return `Search mein store ki visibility kam hui (andaza, ≈${k}/mahina)`;
    case "promotions":
      return "Is mahine koi deal ya ads nahi chale";
    default:
      return null;
  }
}

/** One issue in simple Hinglish: known issues get a fixed line, others stay as written. */
export function hinglishIssue(text: string, diagnosisIssues: Issue[] = diagnose().issues): string {
  if (/competitor|sasta|cheaper/i.test(text)) return "Competitor kuch products kam price par bech raha hai (aapke mutabik)";
  const key = ISSUE_KEYS.find(([re]) => re.test(text))?.[1];
  const issue = key ? diagnosisIssues.find((i) => i.id === key) : undefined;
  return (issue && hinglishIssueById(issue.id, issue.estimated_monthly_impact_inr)) || text;
}

/** "✅ Low-stock alert on karna · ho gaya (~₹4.5k/mahina)" */
export function hinglishActionLine(a: ActionItem): string {
  const title = a.action_type ? HINGLISH_ACTIONS[a.action_type] : a.title;
  const status =
    a.status === "executed"
      ? "ho gaya"
      : `${a.owner === "kam" ? "Priya karegi" : "aapko karna hai"}, ${prettyDate(a.due_date)} tak`;
  const inr = a.expected_recovery_inr ? ` (~${formatInrShort(a.expected_recovery_inr)}/mahina)` : "";
  return `${a.status === "executed" ? "✅" : "⏳"} ${title} · ${status}${inr}`;
}

export function totalRecovery(actions: ActionItem[]): number {
  return actions.reduce((sum, a) => sum + (a.expected_recovery_inr || 0), 0);
}

export function buildWhatsappText(input: {
  issues: string[];
  actions: ActionItem[];
  fallbackActions: string[];
  nextSteps: string[];
  followUp: FollowUp | null;
}): string {
  const firstName = SELLER_PROFILE.seller_name.split(" ")[0];
  const actionLines = input.actions.length ? input.actions.map(hinglishActionLine) : input.fallbackActions.map((a) => `• ${a}`);
  const issueLines = [...new Set(input.issues.map((i) => hinglishIssue(i)))];
  const lines: string[] = [
    `Namaste ${firstName} ji 🙏`,
    `Aaj ki call ka summary (${SELLER_PROFILE.store_name}):`,
    "",
    "*Kya problem hai:*",
    ...issueLines.map((i) => `• ${i}`),
    "",
    "*Action plan:* (✅ ho gaya · ⏳ karna hai)",
    ...actionLines,
  ];
  const recovery = totalRecovery(input.actions);
  if (recovery > 0) {
    lines.push("", `Andazan recovery: ~${formatInrShort(recovery)}/mahina (estimate hai, guarantee nahi)`);
  }
  // To-dos are already in the action plan; follow-up lines are replaced by the real one below.
  const extraSteps = input.nextSteps.filter((s) => !/follow[- ]?up|call back|callback|\bcall\b/i.test(s) && !input.actions.some((a) => a.title === s.split(" by ")[0]));
  if (extraSteps.length) lines.push("", "*Aage kya karna hai:*", ...extraSteps.map((s) => `→ ${s}`));
  if (input.followUp) {
    lines.push("", `📞 Follow-up call: ${prettyDate(input.followUp.date)} ko, progress check karne ke liye`);
  }
  lines.push("", "— Priya, aapki Virtual KAM");
  return lines.join("\n");
}

export function buildSummary(input: {
  issues: string[];
  /** The model's free-text action list, used only if no actions exist in state. */
  modelActions: string[];
  nextSteps: string[];
  followUp: FollowUp | null;
  actionItems: ActionItem[];
  createdAt: string;
  autoGenerated?: boolean;
}): CallSummary {
  const issues = ensureIssues(input.issues, diagnose().issues);
  const actions = input.actionItems.length ? input.actionItems.map(formatActionLine) : input.modelActions;
  // There is exactly one follow-up (from call state). Drop model-written follow-up
  // lines, which may carry a stale or miscalculated date, and add the real one.
  const modelSteps = input.nextSteps.filter((s) => !/follow[- ]?up|call back|callback|call/i.test(s));
  const nextSteps = input.nextSteps.length
    ? [...modelSteps, ...(input.followUp ? [`Follow-up call on ${prettyDate(input.followUp.date)}`] : [])]
    : [
        ...input.actionItems.filter((a) => a.status === "proposed").map((a) => `${a.title} by ${prettyDate(a.due_date)}`),
        ...(input.followUp ? [`Follow-up call on ${prettyDate(input.followUp.date)}`] : []),
      ];
  const text = buildWhatsappText({
    issues,
    actions: input.actionItems,
    fallbackActions: input.modelActions,
    nextSteps,
    followUp: input.followUp,
  });
  return {
    issues,
    actions: actions.length ? actions : ["No actions agreed yet"],
    next_steps: nextSteps.length ? nextSteps : ["Call Priya again to finish the review"],
    whatsapp_text: text,
    whatsapp_url: whatsappUrl(text),
    created_at: input.createdAt,
    auto_generated: input.autoGenerated,
  };
}

/**
 * Deterministic summary used when the seller hangs up before Priya calls
 * end_call_summary, so the user always gets a summary card.
 */
export function buildLocalSummary(input: { actions: ActionItem[]; followUp: FollowUp | null; createdAt: string }): CallSummary {
  return buildSummary({
    issues: [],
    modelActions: [],
    nextSteps: [],
    followUp: input.followUp,
    actionItems: input.actions,
    createdAt: input.createdAt,
    autoGenerated: true,
  });
}
