/**
 * Tool executor, shared by both engines.
 *
 * executeTool() is synchronous and side-effect free: it takes the tool call
 * and a snapshot of the call context and returns
 *   - `response`: compact JSON sent back to the model
 *   - `events`:   typed UI events (reducer → panels)
 *   - `resultLine`: one readable line for the Agent Brain timeline
 *
 * Live mode runs it in the browser; Fallback mode runs it inside /api/chat.
 */
import { METRICS, SELLER_PROFILE, SKUS } from "@/data/seller";
import {
  allRecoveryEstimates,
  buildRestockList,
  computeProgress,
  diagnose,
  estimateRecovery,
  getProducts,
} from "@/lib/diagnose";
import { addDays, resolveDate, spokenDate, toIsoDate, todayInIndia, todayIso } from "@/lib/dates";
import { formatInr, formatInrShort, formatPct, pctChange, uid } from "@/lib/format";
import { matchProducts, splitProductPhrases, uniqueSkus } from "@/lib/products";
import { ACTION_TYPES, type ActionItem, type ActionType, type CallContext, type InsightTopic, type ProductFilter, type UiEvent } from "@/lib/types";
import { type ToolName, isToolName } from "./declarations";
import { guardAwaitingSeller, guardEndCall, guardExecute, guardProposeAction, guardScheduleFollowUp } from "./guards";
import { buildSummary, prettyDate } from "./summary";

export interface ToolExecution {
  response: Record<string, unknown>;
  events: UiEvent[];
  resultLine: string;
}

/** Timeline status for a finished tool call. */
export function traceStatus(response: Record<string, unknown>): "done" | "error" | "blocked" {
  if (response.blocked === true) return "blocked";
  return "error" in response ? "error" : "done";
}

const blocked = (reason: string, events: UiEvent[] = [], awaitSeller = false): ToolExecution => ({
  // await_seller tells the Live engine to mute Priya until the seller speaks.
  response: { ok: false, blocked: true, reason, ...(awaitSeller ? { await_seller: true } : {}) },
  events,
  resultLine: `blocked by guardrail: ${reason}`,
});

const blockedAwaiting = (g: { reason: string }) => blocked(g.reason, [], true);

/** Tool results trigger a new model response; this stops Priya taking a second turn. */
const NO_DOUBLE_TURN =
  "If you have already asked the seller a question in this turn, say nothing more and wait for their answer. Never speak twice in a row.";

/** How Priya should phrase a mock action: prepared for the seller, never "sent" or "changed live". */
const HOW_TO_SAY =
  "Say you have prepared it for them (\"Maine aapke liye ready kar diya hai\") in one sentence. Do not claim anything was sent, messaged, called, or changed in live systems.";

type Args = Record<string, unknown>;

// --- tiny argument readers (the model's JSON is untrusted input) ------------
const str = (a: Args, k: string, fallback = ""): string => (typeof a[k] === "string" ? (a[k] as string).trim() : fallback);
const strArr = (a: Args, k: string): string[] =>
  Array.isArray(a[k]) ? (a[k] as unknown[]).filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
const isActionType = (v: unknown): v is ActionType => typeof v === "string" && (ACTION_TYPES as string[]).includes(v);
const INSIGHT_TOPICS: InsightTopic[] = ["inventory", "supplier", "cancellations", "pricing", "competition", "promotions", "priorities", "other"];

/**
 * Resolve a due date the way the model/seller phrased it ("next Monday",
 * "20 November", YYYY-MM-DD) against today's date in India. Past or
 * unparseable dates fall back to `daysAhead` from today.
 */
export function normalizeDate(value: string, nowIso: string, daysAhead = 3): string {
  const r = value ? resolveDate(value, nowIso) : null;
  if (r && r.days_from_today >= 0) return r.iso;
  return toIsoDate(addDays(todayInIndia(nowIso), daysAhead));
}

/** Guess the executable action type from a title, so "Restock top sellers" and a typed restock merge. */
export function inferActionType(text: string): ActionType | undefined {
  const t = text.toLowerCase();
  if (/reactivat|re-activat|unpause|wapas (live|chalu)|live again/.test(t)) return "reactivate_listings_on_restock";
  if (/\bpause|deactivat|band kar/.test(t)) return "pause_unrestockable_listings";
  if (/alert|notif|reminder/.test(t)) return "enable_stock_alerts";
  if (/targeted|coupon|competitor|(deal|offer|discount) (on|for) (the |that |this )?(one|single|\w+ only)/.test(t)) return "targeted_sku_deal";
  if (/\bdeal|discount|offer|sale\b|promotion/.test(t)) return "enroll_in_deal";
  if (/restock|re-stock|replenish|stock (up|order)|reorder|maal mangwa/.test(t)) return "generate_restock_list";
  return undefined;
}

/** Same words, ignoring order and filler: used to merge untyped duplicate actions. */
function sameTitle(a: string, b: string): boolean {
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return false;
  const shared = [...A].filter((w) => B.has(w)).length;
  return shared / Math.min(A.size, B.size) >= 0.6;
}

/** Phrases that mark Priya's own notes or to-dos, not something the seller said. */
const NOT_SELLER_SPEECH =
  /\b(needs? (to be )?confirm\w*|to be confirmed|confirmation (is )?(needed|required|pending)|needs? confirmation|by (the )?seller|seller (should|needs to|must|to confirm|has to)|recommend\w*|suggest\w*|follow up with|priya)\b/i;

const ACTION_TITLES: Record<ActionType, string> = {
  generate_restock_list: "Restock top-selling SKUs",
  pause_unrestockable_listings: "Pause listings that can't be restocked soon",
  enable_stock_alerts: "Turn on low-stock alerts",
  enroll_in_deal: "Join a category deal once stock is back",
  reactivate_listings_on_restock: "Reactivate listings the day stock lands",
  targeted_sku_deal: "Targeted coupon on the competitor-pressured product",
};

/** Placeholder insights ("details pending") add noise; record once the seller gives the details. */
const PLACEHOLDER = /\b(pending|tbd|to be (shared|confirmed|provided)|not (yet )?(specified|shared|known|mentioned)|unknown|details? (awaited|missing))\b/i;

/** Same topic + overlapping words = the same insight (or a placeholder being filled in). */
function findDuplicateInsight(ctx: CallContext, topic: InsightTopic, detail: string) {
  return ctx.insights.find((i) => i.topic === topic && (PLACEHOLDER.test(i.detail) || sameTitle(i.detail, detail)));
}

// ---------------------------------------------------------------------------

export function executeTool(name: string | undefined, rawArgs: unknown, ctx: CallContext): ToolExecution {
  const args: Args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Args) : {};
  if (!isToolName(name)) {
    return { response: { error: `Unknown tool ${name}` }, events: [], resultLine: `unknown tool ${name}` };
  }
  try {
    return HANDLERS[name](args, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { response: { error: message }, events: [], resultLine: `error: ${message}` };
  }
}

const HANDLERS: Record<ToolName, (args: Args, ctx: CallContext) => ToolExecution> = {
  get_seller_metrics(_args, ctx) {
    const last = METRICS.last_month;
    const cur = METRICS.this_month;
    const executedLastTime = (ctx.memory?.actions ?? []).filter((a) => a.status === "executed" && a.action_type).map((a) => a.action_type as ActionType);
    const progress = ctx.mode === "follow_up" && ctx.memory ? computeProgress(executedLastTime) : null;
    return {
      response: {
        profile: SELLER_PROFILE,
        last_month: last,
        this_month: cur,
        changes: {
          sales_pct: pctChange(last.sales_inr, cur.sales_inr),
          orders_pct: pctChange(last.orders, cur.orders),
          avg_selling_price_pct: pctChange(last.avg_selling_price_inr, cur.avg_selling_price_inr),
          cancellation_rate_points: Math.round((cur.cancellation_rate - last.cancellation_rate) * 100),
          out_of_stock_change: cur.out_of_stock_products - last.out_of_stock_products,
        },
        ...(progress ? { progress_since_last_call: progress } : {}),
      },
      events: [{ type: "metrics_viewed", progress }],
      resultLine: `sales ${formatInrShort(last.sales_inr)} → ${formatInrShort(cur.sales_inr)} (${pctChange(last.sales_inr, cur.sales_inr)}%), ASP flat${progress ? ", progress loaded" : ""}`,
    };
  },

  run_diagnosis() {
    const d = diagnose();
    const top = d.issues[0];
    return {
      response: {
        headline: d.headline.statement,
        ruled_out: d.ruled_out,
        issues: d.issues.map((i) => ({
          id: i.id,
          title: i.title,
          severity: i.severity,
          summary: i.summary,
          evidence: i.evidence,
          estimated_monthly_impact_inr: i.estimated_monthly_impact_inr,
          confidence: i.confidence,
        })),
        recovery_estimates: allRecoveryEstimates(),
        note: d.note,
        instruction: "Quote only these numbers, rounded naturally. Lead with the biggest issue and say pricing is not the cause.",
      },
      events: [{ type: "diagnosis", diagnosis: d }],
      resultLine: `${d.issues.length} issues, biggest: stock-outs ≈ ${formatInrShort(top.estimated_monthly_impact_inr)}/month; pricing ruled out`,
    };
  },

  get_product_breakdown(args) {
    const product = str(args, "product");
    if (product) return productComparison(product, args.competitor_price_inr);
    const raw = str(args, "filter", "out_of_stock");
    const filter: ProductFilter = raw === "top_sellers" || raw === "all" ? raw : "out_of_stock";
    const rows = getProducts(filter);
    const lost = rows.reduce((s, r) => s + r.lost_revenue_inr, 0);
    return {
      response: { filter, count: rows.length, products: rows },
      events: [{ type: "products_viewed", filter, count: rows.length }],
      resultLine: `${rows.length} ${filter.replace(/_/g, " ")} SKUs, top: ${rows[0]?.name ?? "n/a"} (${formatInrShort(lost)} lost)`,
    };
  },

  record_seller_insight(args, ctx) {
    const rawTopic = str(args, "topic", "other");
    const topic = (INSIGHT_TOPICS as string[]).includes(rawTopic) ? (rawTopic as InsightTopic) : "other";
    const detail = str(args, "detail");
    const sellerWords = str(args, "seller_words");
    if (!detail) return { response: { error: "detail is required" }, events: [], resultLine: "missing detail" };
    // Insights are the SELLER's facts and opinions, never Priya's own notes or to-dos.
    if (!sellerWords) {
      return blocked(`Insights must come from the seller. Pass the seller's own words as seller_words. If the seller didn't say this, don't record it. ${NO_DOUBLE_TURN}`);
    }
    if (ctx.signals && !ctx.signals.seller_spoke_at) {
      return blocked(`The seller hasn't said anything yet, so there is nothing to record. ${NO_DOUBLE_TURN}`);
    }
    if (NOT_SELLER_SPEECH.test(detail)) {
      return blocked(
        `"${detail}" reads like your own note or to-do, not something the seller said. Only record facts or opinions the seller stated (e.g. "supplier delayed; restock by 20 Nov", "thinks a competitor is selling cheaper"). If you need information, ask the seller. ${NO_DOUBLE_TURN}`,
      );
    }
    if (PLACEHOLDER.test(detail)) {
      return blocked(`Don't record placeholders like "${detail}". Ask the seller for the details and record them once, in one insight. ${NO_DOUBLE_TURN}`);
    }
    // Same topic and overlapping content: update the earlier insight instead of adding another.
    const dup = findDuplicateInsight(ctx, topic, detail);
    const keepOld = dup && !PLACEHOLDER.test(dup.detail) && !sameTitle(dup.detail, detail);
    const insight = { id: dup?.id ?? uid("ins"), topic, detail: keepOld ? `${dup.detail}; ${detail}` : detail, at: ctx.now_iso };
    return {
      response: { ok: true, saved: insight.detail, ...(dup ? { merged_with_earlier: true } : {}), instruction: `Adapt your plan to this. ${NO_DOUBLE_TURN}` },
      events: [{ type: "insight_recorded", insight }],
      resultLine: `${dup ? "updated" : "noted"} (${topic}): “${insight.detail}”`,
    };
  },

  propose_action(args, ctx) {
    const guard = guardProposeAction(ctx);
    if (guard) return blocked(guard.reason);
    const title = str(args, "title");
    // Untyped proposals get a type inferred from the title, so "Restock top 5 sellers"
    // and "Generate restock list" become one action instead of two.
    const actionType = isActionType(args.action_type) ? args.action_type : (inferActionType(title) ?? inferActionType(str(args, "why")));
    // Numbers come from code: typed actions get the engine estimate; untyped ones get none,
    // because a model-invented ₹ figure must never be quoted.
    const recovery = actionType ? estimateRecovery(actionType).expected_recovery_inr : 0;
    const existing = ctx.actions.find((a) => (actionType ? a.action_type === actionType : !a.action_type && sameTitle(a.title, title)));
    const action: ActionItem = {
      id: existing?.id ?? uid("act"),
      title: title || (actionType ? ACTION_TITLES[actionType] : "Action"),
      why: str(args, "why"),
      expected_recovery_inr: recovery,
      owner: str(args, "owner") === "kam" ? "kam" : "seller",
      due_date: normalizeDate(str(args, "due_date"), ctx.now_iso),
      status: "proposed",
      action_type: actionType,
    };
    const due = resolveDate(action.due_date, ctx.now_iso);
    return {
      response: {
        ok: true,
        action_id: action.id,
        ...(existing ? { updated_existing: existing.title, note_update: "This replaced the existing action of the same kind; the plan has no duplicates." } : {}),
        expected_recovery_inr: recovery,
        due_date: action.due_date,
        due_date_spoken: due?.spoken,
        actions_in_plan: ctx.actions.length + (existing ? 0 : 1),
        ...(actionType
          ? {
              executable: true,
              hint: "You may offer to prepare this ONCE, after answering anything the seller asked. If they ignore or deflect the offer, don't repeat it. Only call execute_mock_action after an explicit yes.",
            }
          : { note: "No official ₹ estimate for an untyped action. Do not quote a rupee figure for it." }),
        instruction: NO_DOUBLE_TURN,
      },
      events: [{ type: "action_proposed", action }],
      resultLine: `${existing ? "updated " : ""}“${action.title}”: ~${formatInrShort(recovery)}/month, ${action.owner}, due ${prettyDate(action.due_date)}`,
    };
  },

  execute_mock_action(args, ctx) {
    const type = isActionType(args.type) ? args.type : undefined;
    if (!type) return { response: { error: "Unknown action type" }, events: [], resultLine: "unknown action type" };
    const quote = str(args, "seller_consent_quote");
    const waiting = guardAwaitingSeller(ctx, "execute");
    if (waiting) return blockedAwaiting(waiting);
    const guard = guardExecute(ctx, type, quote);
    if (guard) {
      // A proposed, not-yet-done action that didn't get a yes: remember it so Priya doesn't push it again.
      const pending = ctx.actions.some((a) => a.action_type === type && a.status === "proposed");
      return blocked(guard.reason, pending ? [{ type: "offer_declined", action_type: type }] : []);
    }
    const details = str(args, "details");
    const payload = mockActionPayload(type, details, strArr(args, "products"), ctx);
    if ("needsInput" in payload) {
      return {
        response: { ok: false, not_executed: true, reason: payload.needsInput },
        events: [],
        resultLine: `not executed: ${payload.needsInput}`,
      };
    }
    const ref = `SD-${REF_CODES[type]}-${Math.floor(1000 + Math.random() * 9000)}`;
    const { result, lines, modelItems } = payload;
    const recovery = estimateRecovery(type).expected_recovery_inr;
    const fallback: ActionItem = {
      id: uid("act"),
      title: ACTION_TITLES[type],
      why: "Executed during the call at the seller's request.",
      expected_recovery_inr: recovery,
      owner: "kam",
      due_date: todayIso(ctx.now_iso),
      status: "executed",
      action_type: type,
      execution_result: `${result} (ref ${ref})`,
      execution_lines: lines,
    };
    return {
      response: {
        ok: true,
        status: "prepared",
        reference_id: ref,
        confirmation: result,
        items: modelItems,
        how_to_say: `${HOW_TO_SAY} If the seller asked for several things at once, handle each, then confirm all of them together in one short sentence.`,
      },
      events: [{ type: "action_executed", action_type: type, result: `${result} (ref ${ref})`, lines, fallback_action: fallback }],
      resultLine: `${result} · ref ${ref}`,
    };
  },

  schedule_follow_up(args, ctx) {
    // The date is resolved HERE from the seller's words, against today's date in India.
    const waiting = guardScheduleFollowUp(ctx);
    if (waiting) return blockedAwaiting(waiting);
    const said = str(args, "when") || str(args, "date");
    const r = resolveDate(said, ctx.now_iso);
    if (!r || r.days_from_today < 1) {
      return {
        response: {
          ok: false,
          not_scheduled: true,
          reason: r
            ? `"${said}" is ${r.days_from_today === 0 ? "today" : "in the past"} (today is ${spokenDate(todayInIndia(ctx.now_iso))}). Ask the seller for a later day.`
            : `Couldn't understand the date "${said}". Ask the seller which day works (e.g. "next Monday" or "20 November") and pass their words.`,
        },
        events: [],
        resultLine: `follow-up not scheduled: unclear date “${said}”`,
      };
    }
    const follow_up = { date: r.iso, purpose: str(args, "purpose") || "Check progress on agreed actions" };
    const previous = ctx.follow_up;
    const replaced = previous && previous.date !== r.iso ? previous : null;
    return {
      response: {
        ok: true,
        scheduled_for: r.iso,
        say_exactly: r.spoken,
        weekday: r.weekday,
        ...(replaced ? { replaced_previous: `${prettyDate(replaced.date)} (only one follow-up per call; the old one is cancelled)` } : {}),
        instruction: `Say the date exactly as "${r.spoken}" (you may say it in Hindi, e.g. weekday + date). Never compute dates yourself. ${NO_DOUBLE_TURN}`,
      },
      events: [{ type: "follow_up_scheduled", follow_up }],
      resultLine: `follow-up on ${r.spoken}${replaced ? ` (replaces ${prettyDate(replaced.date)})` : ""}: ${follow_up.purpose}`,
    };
  },

  escalate_to_human_kam(args, ctx) {
    const reason = str(args, "reason") || "Seller requested a human";
    const escalation = { reason, ticket_id: `KAM-${Math.floor(100000 + Math.random() * 900000)}`, at: ctx.now_iso };
    return {
      response: {
        ok: true,
        ticket_id: escalation.ticket_id,
        expected_sla: "A human KAM typically calls back within 4 working hours.",
        how_to_say: "Say you have raised a request for a human KAM and share the ticket number. Do not promise an exact time.",
      },
      events: [{ type: "escalated", escalation }],
      resultLine: `escalated (${escalation.ticket_id}): ${reason}`,
    };
  },

  end_call_summary(args, ctx) {
    const waiting = guardAwaitingSeller(ctx, "end");
    if (waiting) return blockedAwaiting(waiting);
    const guard = guardEndCall(ctx, args.seller_declined_more_help === true, args.follow_up_declined === true);
    if (guard) return blocked(guard.reason, [], guard.reason.includes("has NOT answered"));
    const summary = buildSummary({
      issues: strArr(args, "issues"),
      modelActions: strArr(args, "actions"),
      nextSteps: strArr(args, "next_steps"),
      followUp: ctx.follow_up,
      actionItems: ctx.actions,
      createdAt: ctx.now_iso,
    });
    return {
      response: {
        ok: true,
        summary_on_screen: true,
        instruction:
          "You already gave the recap. Now say ONE warm goodbye sentence, mentioning the summary is ready on their screen and they can share it on WhatsApp (e.g. \"Summary aapki screen par ready hai, aap ise WhatsApp par share kar sakte hain.\"). Never say you sent it.",
      },
      events: [{ type: "summary_ready", summary }],
      resultLine: `summary ready: ${summary.issues.length} issues, ${summary.actions.length} actions, WhatsApp link built`,
    };
  },
};

// ---------------------------------------------------------------------------
// Realistic confirmations for the mock actions
// ---------------------------------------------------------------------------

const REF_CODES: Record<ActionType, string> = {
  generate_restock_list: "RST",
  pause_unrestockable_listings: "PSE",
  enable_stock_alerts: "ALR",
  enroll_in_deal: "DEAL",
  reactivate_listings_on_restock: "REA",
  targeted_sku_deal: "CPN",
};

type Payload = { result: string; lines: string[]; modelItems: unknown[] } | { needsInput: string };

function mockActionPayload(type: ActionType, details: string, products: string[], ctx: CallContext): Payload {
  switch (type) {
    case "generate_restock_list": {
      const list = buildRestockList();
      const units = list.reduce((s, l) => s + l.suggested_qty, 0);
      return {
        result: `Restock list ready: ${list.length} SKUs, ${units} units (biggest losses first)`,
        lines: list.map((l) => `${l.sku} · ${l.name}: ${l.suggested_qty} units`),
        modelItems: list.slice(0, 5).map((l) => ({ name: l.name, qty: l.suggested_qty, lost_inr: l.lost_revenue_inr })),
      };
    }
    case "pause_unrestockable_listings": {
      // Pause ONLY the products the seller named, fuzzy-matched against the catalogue.
      const phrases = products.length ? products.flatMap(splitProductPhrases) : splitProductPhrases(details);
      const { matches, unmatched } = matchProducts(phrases);
      const toPause = uniqueSkus(matches);
      const oosNames = SKUS.filter((s) => s.stock_status === "out_of_stock").map((s) => s.name);
      if (!toPause.length) {
        return {
          needsInput: `${phrases.length ? `No listing matches ${phrases.map((p) => `"${p}"`).join(", ")}.` : "No products were named."} Nothing was paused. Ask the seller exactly which products can't be restocked soon, then pass those names in products. Out-of-stock listings: ${oosNames.join("; ")}.`,
        };
      }
      const ambiguous = matches.filter((m) => m.skus.length > 1);
      return {
        result: `Pause prepared for ${toPause.length} listing${toPause.length > 1 ? "s" : ""} the seller named: ${toPause.map((s) => s.name).join(", ")}; they can be reactivated when stock is updated`,
        lines: [
          ...toPause.map((s) => `${s.sku} · ${s.name}: paused${s.days_out_of_stock ? ` (${s.days_out_of_stock} days out of stock)` : ""}`),
          ...unmatched.map((u) => `“${u}”: no matching listing, not paused`),
        ],
        modelItems: [
          { paused: toPause.map((s) => s.name) },
          ...(unmatched.length ? [{ not_found: unmatched, note: "Tell the seller these didn't match any listing." }] : []),
          ...(ambiguous.length
            ? [{ note: `"${ambiguous.map((a) => a.query).join('", "')}" matched more than one listing; name them to the seller so they can correct you.` }]
            : []),
          { say: "Name the paused products to the seller. Nothing else was paused." },
        ],
      };
    }
    case "enable_stock_alerts": {
      const alerts = SKUS.filter((s) => s.units_last_month >= 8).map((s) => ({
        name: s.name,
        sku: s.sku,
        // 7 days of cover at last month's run-rate.
        threshold: Math.max(3, Math.ceil((s.units_last_month / 30) * 7)),
      }));
      return {
        result: `Low-stock alert rules prepared for ${alerts.length} SKUs (alert at 7 days of cover)`,
        lines: alerts.slice(0, 10).map((a) => `${a.sku} · ${a.name}: alert below ${a.threshold} units`),
        modelItems: [{ skus: alerts.length, rule: "alert at 7 days of cover" }],
      };
    }
    case "enroll_in_deal": {
      const start = resolveDate("next saturday", ctx.now_iso)!; // always resolvable
      const inStock = SKUS.filter((s) => s.stock_status === "in_stock");
      return {
        result: `Deal enrolment prepared: “Home & Kitchen Weekend Deal” from ${start.spoken}, 10% off ${inStock.length} in-stock SKUs; restocked items can join`,
        lines: [
          `Deal window: ${start.spoken}, 3 days`,
          "Discount: 10% (platform co-funds visibility boost)",
          ...inStock.map((s) => `${s.sku} · ${s.name}: ${formatInr(Math.round(s.price_inr * 0.9))} deal price`),
        ],
        modelItems: [{ deal: "Home & Kitchen Weekend Deal", starts: start.iso, discount: formatPct(0.1), skus: inStock.length }],
      };
    }
    case "reactivate_listings_on_restock": {
      // Every currently out-of-stock SKU goes live again the moment stock is updated.
      const oos = SKUS.filter((s) => s.stock_status === "out_of_stock");
      return {
        result: `Auto-reactivation prepared for ${oos.length} listings: each goes live the day its stock is updated`,
        lines: oos.map((s) => `${s.sku} · ${s.name}: reactivate on restock`),
        modelItems: [{ listings: oos.length, rule: "reactivate the same day stock is updated" }],
      };
    }
    case "targeted_sku_deal": {
      // A coupon on ONLY the product(s) the seller named, live once each is in stock.
      const phrases = products.length ? products.flatMap(splitProductPhrases) : splitProductPhrases(details);
      const skus = uniqueSkus(matchProducts(phrases).matches);
      if (!skus.length) {
        return { needsInput: "Which product is the competitor undercutting? Ask the seller, then pass that product in products. Nothing was prepared." };
      }
      return {
        result: `Targeted 10% coupon prepared for ${skus.map((s) => s.name).join(", ")}; goes live ${skus.some((s) => s.stock_status === "out_of_stock") ? "the day stock is back" : "this week"}`,
        lines: skus.map(
          (s) => `${s.sku} · ${s.name}: ${formatInr(s.price_inr)} → ${formatInr(Math.round(s.price_inr * 0.9))} with coupon${s.stock_status === "out_of_stock" ? " (starts when restocked)" : ""}`,
        ),
        modelItems: skus.map((s) => ({ name: s.name, our_price: s.price_inr, coupon_price: Math.round(s.price_inr * 0.9), in_stock: s.stock_status !== "out_of_stock" })),
      };
    }
  }
}

/**
 * One product vs a competitor's price, grounded in our catalogue. The key
 * point: if our SKU is out of stock, buyers go to the competitor because we
 * have nothing to sell, not (only) because the competitor is cheaper.
 */
function productComparison(product: string, rawCompetitorPrice: unknown): ToolExecution {
  const skus = uniqueSkus(matchProducts([product]).matches);
  if (!skus.length) {
    return {
      response: { ok: false, reason: `No listing matches "${product}". Ask the seller which product they mean.`, catalogue: SKUS.map((s) => s.name) },
      events: [],
      resultLine: `no listing matches “${product}”`,
    };
  }
  const competitor = typeof rawCompetitorPrice === "number" && rawCompetitorPrice > 0 ? Math.round(rawCompetitorPrice) : null;
  const rows = skus.map((s) => {
    const oos = s.stock_status === "out_of_stock";
    const gap = competitor !== null ? s.price_inr - competitor : null;
    const gapPct = gap !== null ? Math.round((gap / s.price_inr) * 100) : null;
    let advice: string;
    if (oos) {
      advice = `Our ${s.name} is OUT OF STOCK (${s.days_out_of_stock} days), so buyers go to the competitor mainly because we have nothing to sell. Restock first; then, only if the price gap matters, a targeted coupon on this product.`;
    } else if (gapPct !== null && gapPct > 5) {
      advice = `In stock, and we are about ${gapPct}% (₹${gap}) dearer. A targeted coupon on this product alone can close the gap; don't cut prices across the catalogue (the average price is flat and isn't the cause).`;
    } else if (gapPct !== null) {
      advice = "In stock and the price gap is small. Price isn't the issue here; focus on stock and visibility, not a price cut.";
    } else {
      advice = "Ask the seller the competitor's price to compare.";
    }
    return {
      name: s.name,
      our_price_inr: s.price_inr,
      competitor_price_inr: competitor,
      gap_inr: gap,
      gap_pct_of_our_price: gapPct,
      stock_status: s.stock_status,
      days_out_of_stock: s.days_out_of_stock,
      units_last_month: s.units_last_month,
      units_this_month: s.units_this_month,
      advice,
    };
  });
  const r = rows[0];
  return {
    response: {
      ok: true,
      products: rows,
      instruction:
        "Say our price vs the competitor's out loud, say if ours is out of stock, then give the advice. Never suggest cutting prices across the catalogue: the average selling price is flat. If useful, propose a targeted_sku_deal for this product (after restock if it's out of stock).",
    },
    events: [{ type: "products_viewed", filter: "all", count: rows.length }],
    resultLine: `${r.name}: ours ${formatInr(r.our_price_inr)}${r.competitor_price_inr !== null ? ` vs competitor ${formatInr(r.competitor_price_inr)}` : ""}, ${r.stock_status.replace(/_/g, " ")}`,
  };
}
