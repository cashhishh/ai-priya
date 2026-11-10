/**
 * Tool (function) declarations, shared by BOTH voice engines:
 *  - Live mode:     passed to ai.live.connect() in the browser
 *  - Fallback mode: passed to generateContent() on the server (/api/chat)
 *
 * One source of truth → the agent behaves the same whichever engine runs.
 */
import { Behavior, Type, type FunctionDeclaration } from "@google/genai";
import { ACTION_TYPES } from "@/lib/types";

export const TOOL_NAMES = [
  "get_seller_metrics",
  "run_diagnosis",
  "get_product_breakdown",
  "record_seller_insight",
  "propose_action",
  "execute_mock_action",
  "schedule_follow_up",
  "escalate_to_human_kam",
  "end_call_summary",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(name: string | undefined): name is ToolName {
  return !!name && (TOOL_NAMES as readonly string[]).includes(name);
}

const stringArray = (description: string) => ({
  type: Type.ARRAY,
  description,
  items: { type: Type.STRING },
});

export const FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_seller_metrics",
    description:
      "Get the seller's profile and key metrics for last month vs this month (sales, orders, cancellation rate, average selling price, out-of-stock products). In follow-up calls it also returns progress since the last call.",
  },
  {
    name: "run_diagnosis",
    description:
      "Run the deterministic diagnosis engine. Returns the headline (why sales changed), causes ruled out, issues ranked by estimated monthly ₹ impact with evidence and confidence, and ₹ recovery estimates per action. ALWAYS call this before explaining why sales dropped.",
  },
  {
    name: "get_product_breakdown",
    description:
      "Get SKU-level details: units sold last vs this month, stock status, days out of stock and lost revenue. Pass `product` (and `competitor_price_inr` if the seller gave one) to look up ONE product and compare our price with a competitor's; ALWAYS do this when the seller names a product a competitor sells cheaper.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        filter: {
          type: Type.STRING,
          enum: ["out_of_stock", "top_sellers", "all"],
          description: "Which products to return (ignored when product is set).",
        },
        product: { type: Type.STRING, description: "One product in the seller's words, e.g. 'pressure cooker'." },
        competitor_price_inr: { type: Type.NUMBER, description: "The competitor's price the seller mentioned, in rupees." },
      },
    },
  },
  {
    name: "record_seller_insight",
    description:
      "Save a fact or opinion THE SELLER said that the data cannot show: supplier delays and restock dates, which products matter most, what can't be restocked, cancellation reasons, competitor prices, their own views (e.g. 'thinks price is too high'), and anything they already did (e.g. 'already paused out-of-stock listings'). Call it right after they say it, before you reply. NEVER record your own statements, assumptions, questions or to-dos (wrong: 'cooker stock availability needs confirmation by seller').",
    parameters: {
      type: Type.OBJECT,
      properties: {
        topic: {
          type: Type.STRING,
          enum: ["inventory", "supplier", "cancellations", "pricing", "competition", "promotions", "priorities", "other"],
        },
        detail: { type: Type.STRING, description: "Short note in English of what the seller said, e.g. 'Supplier delayed; restock expected by 20 Nov'." },
        seller_words: { type: Type.STRING, description: "The seller's own words this comes from, as they said them." },
      },
      required: ["topic", "detail", "seller_words"],
    },
  },
  {
    name: "propose_action",
    description:
      "Add one specific, prioritised action to the seller's action plan, or update it: proposing the same kind of action again replaces the old one, so never add near-duplicates. A good plan has 2–3 distinct actions. Always set action_type so the system attaches the official ₹ estimate (without action_type the action has NO ₹ figure and you must not quote one). Requires run_diagnosis and enough seller insights first.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Short imperative title, e.g. 'Restock top 5 sellers first'." },
        why: { type: Type.STRING, description: "One sentence linking the action to the issue and what the seller said." },
        expected_recovery_inr: { type: Type.NUMBER, description: "Estimated monthly ₹ recovery (from run_diagnosis)." },
        owner: { type: Type.STRING, enum: ["seller", "kam"] },
        due_date: { type: Type.STRING, description: "Due date as the seller said it ('next Monday', '20 November') or YYYY-MM-DD; resolved by the system against today's date." },
        action_type: {
          type: Type.STRING,
          enum: [...ACTION_TYPES],
          description: "The executable action this maps to, if any.",
        },
      },
      required: ["title", "why", "expected_recovery_inr", "owner", "due_date"],
    },
  },
  {
    name: "execute_mock_action",
    description:
      "Prepare an already-proposed action for the seller (e.g. a restock list with quantities). ONLY call after the seller explicitly says yes to doing it now (\"haan\", \"kar do\", \"yes\"). \"Nahi\", \"bas theek hai\" or anything unclear is NOT consent.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, enum: [...ACTION_TYPES] },
        seller_consent_quote: {
          type: Type.STRING,
          description: "The seller's exact words agreeing to this action now, e.g. 'haan, kar do'.",
        },
        products: stringArray(
          "For pause_unrestockable_listings and targeted_sku_deal: ONLY the products the seller named, in their words (e.g. ['copper bottle']). Never add products the seller didn't name.",
        ),
        details: {
          type: Type.STRING,
          description: "Optional specifics from the conversation.",
        },
      },
      required: ["type", "seller_consent_quote"],
    },
  },
  {
    name: "schedule_follow_up",
    description:
      "Schedule THE follow-up call (one per call; calling again replaces it). Pass the day as the seller said it; the system resolves it against today's real date and returns say_exactly, the date you must speak.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        when: { type: Type.STRING, description: "The day in the seller's words: 'next Monday', 'in a week', '20 November', 'agle somvar', or YYYY-MM-DD." },
        purpose: { type: Type.STRING },
      },
      required: ["when", "purpose"],
    },
  },
  {
    name: "escalate_to_human_kam",
    description:
      "Hand the seller over to a human Key Account Manager: angry or distressed seller, payment/settlement or policy issues, account suspension, or anything outside your scope.",
    parameters: {
      type: Type.OBJECT,
      properties: { reason: { type: Type.STRING } },
      required: ["reason"],
    },
  },
  {
    name: "end_call_summary",
    description:
      "Call once, at the very end, in a turn AFTER the seller has answered 'Kuch aur help chahiye?' with a no or a goodbye. Never in the same turn as asking it. Requires 2–3 proposed actions and a confirmed follow-up. Builds the on-screen summary that the seller can share on WhatsApp (it does NOT send anything).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        issues: stringArray("All issues discussed (at least 2), most important first. Short phrases in simple Hinglish, e.g. 'Top sellers out of stock ho gaye'."),
        actions: stringArray("Actions discussed, short phrases (the system lists every proposed action with its status)."),
        next_steps: stringArray("Concrete next steps with dates, in simple Hinglish, e.g. 'Supplier se 20 Nov tak maal mangwana'."),
        seller_declined_more_help: {
          type: Type.BOOLEAN,
          description: "true only if you asked 'Kuch aur help chahiye?' and the seller declined or said goodbye.",
        },
        follow_up_declined: {
          type: Type.BOOLEAN,
          description: "true only if the seller explicitly refused a follow-up call.",
        },
      },
      required: ["issues", "actions", "next_steps", "seller_declined_more_help"],
    },
  },
];

/**
 * Live-mode declarations: every tool is BLOCKING and every response uses the
 * default scheduling. (NON_BLOCKING + SILENT responses for the bookkeeping
 * tools made Priya skip replies in real calls, so they were removed.)
 * `behavior` is only accepted by the Live API, so the fallback uses the plain list.
 */
export const LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = FUNCTION_DECLARATIONS.map((d) => ({
  ...d,
  behavior: Behavior.BLOCKING,
}));
