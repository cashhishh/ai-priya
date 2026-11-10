/**
 * Tests for the second round of real-call fixes: wrap-up timing, pushiness,
 * dates, pausing only named products, seller-only insights, duplicate actions,
 * and prompt rules.
 */
import { describe, expect, it } from "vitest";
import { resolveDate, upcomingCalendar } from "@/lib/dates";
import { matchProducts } from "@/lib/products";
import { buildSystemPrompt } from "@/lib/prompts";
import { applyEventToContext } from "@/lib/tools/context";
import { executeTool, inferActionType, traceStatus } from "@/lib/tools/executor";
import { updateSignals, wrapUpState } from "@/lib/tools/signals";
import { buildSummary } from "@/lib/tools/summary";
import type { CallContext, ConversationSignals } from "@/lib/types";
import type { TranscriptOp } from "@/lib/voice/types";

// Tuesday 10 Nov 2026, 11:30 IST
const NOW = "2026-11-10T06:00:00.000Z";

const base = (over: Partial<CallContext> = {}): CallContext => ({
  mode: "inbound",
  insights: [],
  actions: [],
  follow_up: null,
  memory: null,
  now_iso: NOW,
  ...over,
});

function run(c: CallContext, name: string, args: Record<string, unknown> = {}) {
  const r = executeTool(name, args, c);
  let next = c;
  for (const e of r.events) next = applyEventToContext(next, e);
  return { r, ctx: next };
}

function ready(): CallContext {
  let c = run(base(), "run_diagnosis").ctx;
  c = run(c, "record_seller_insight", { topic: "supplier", detail: "Supplier delayed; restock by 20 Nov", seller_words: "bees tak maal aa jayega" }).ctx;
  c = run(c, "record_seller_insight", { topic: "inventory", detail: "Copper bottle supplier shut", seller_words: "copper bottle ka supplier band" }).ctx;
  return c;
}

const propose = (c: CallContext, args: Record<string, unknown>) =>
  run(c, "propose_action", { why: "x", expected_recovery_inr: 1, owner: "seller", due_date: "2026-11-20", ...args });

function signals(ops: [TranscriptOp, number][]): ConversationSignals {
  return ops.reduce<ConversationSignals>((s, [op, at]) => updateSignals(s, op, at), {});
}

/** A context ready to wrap up (2 actions + follow-up), with the given transcript signals. */
function readyToEnd(sig: ConversationSignals): CallContext {
  let c = ready();
  c = propose(c, { title: "Restock", action_type: "generate_restock_list" }).ctx;
  c = propose(c, { title: "Alerts", action_type: "enable_stock_alerts" }).ctx;
  c = propose(c, { title: "Deal", action_type: "enroll_in_deal" }).ctx;
  c = run(c, "schedule_follow_up", { when: "next Monday", purpose: "Check" }).ctx;
  return { ...c, signals: sig };
}
const END_ARGS = { issues: ["a", "b"], actions: ["x"], next_steps: [], seller_declined_more_help: true };

describe("dates (today = Tuesday 10 Nov 2026, IST)", () => {
  const iso = (s: string) => resolveDate(s, NOW)?.iso;

  it("resolves relative days in code", () => {
    expect(iso("next Monday")).toBe("2026-11-16");
    expect(resolveDate("next Monday", NOW)?.spoken).toBe("Monday, 16 November");
    expect(iso("Monday")).toBe("2026-11-16");
    expect(iso("agle somvar")).toBe("2026-11-16");
    expect(iso("Tuesday")).toBe("2026-11-17"); // same weekday as today → next week
    expect(iso("in a week")).toBe("2026-11-17");
    expect(iso("ek hafte baad")).toBe("2026-11-17");
    expect(iso("in 3 days")).toBe("2026-11-13");
    expect(iso("kal")).toBe("2026-11-11");
    expect(iso("parso")).toBe("2026-11-12");
  });

  it("resolves calendar dates, rolling past ones forward", () => {
    expect(iso("20 November")).toBe("2026-11-20");
    expect(iso("Nov 20th")).toBe("2026-11-20");
    expect(iso("the 20th")).toBe("2026-11-20");
    expect(iso("bees tareekh")).toBe("2026-11-20");
    expect(iso("5 tareekh")).toBe("2026-12-05");
    expect(iso("20/11")).toBe("2026-11-20");
    expect(iso("2026-11-18")).toBe("2026-11-18");
    expect(iso("someday")).toBeUndefined();
  });

  it("uses the India date even late at night UTC", () => {
    // 20:00 UTC on 10 Nov is already 11 Nov in India.
    expect(resolveDate("tomorrow", "2026-11-10T20:00:00Z")?.iso).toBe("2026-11-12");
  });

  it("gives the model a real calendar", () => {
    expect(upcomingCalendar(NOW)).toContain("Monday, 16 November 2026 = 2026-11-16");
  });

  it("schedule_follow_up returns the date to speak, and a second one replaces the first", () => {
    let { r, ctx: c } = run(ready(), "schedule_follow_up", { when: "next Monday", purpose: "Check restock" });
    expect(r.response.say_exactly).toBe("Monday, 16 November");
    expect(c.follow_up?.date).toBe("2026-11-16");
    ({ r, ctx: c } = run(c, "schedule_follow_up", { when: "in a week", purpose: "Check restock" }));
    expect(c.follow_up?.date).toBe("2026-11-17");
    expect(String(r.response.replaced_previous)).toMatch(/16 Nov/);
  });

  it("refuses unclear or past follow-up dates instead of guessing", () => {
    expect(run(ready(), "schedule_follow_up", { when: "jab maal aaye", purpose: "x" }).ctx.follow_up).toBeNull();
    expect(run(ready(), "schedule_follow_up", { when: "2026-11-01", purpose: "x" }).r.response.not_scheduled).toBe(true);
  });

  it("the summary has exactly one follow-up line, from call state", () => {
    const s = buildSummary({
      issues: ["a", "b"],
      modelActions: [],
      nextSteps: ["Restock cooker", "Follow-up call on 14 Nov"],
      followUp: { date: "2026-11-16", purpose: "Check" },
      actionItems: [],
      createdAt: NOW,
    });
    expect(s.next_steps).toEqual(["Restock cooker", "Follow-up call on 16 Nov"]);
  });
});

describe("pause only what the seller named", () => {
  it("fuzzy-matches product names", () => {
    const names = (q: string) => matchProducts([q]).matches.flatMap((m) => m.skus.map((s) => s.sku));
    expect(names("copper bottle")).toEqual(["RHE-107"]);
    expect(names("taambe ki botal")).toEqual(["RHE-107"]);
    expect(names("bottle")).toEqual(["RHE-107", "RHE-111"]); // ambiguous: both bottles
    expect(names("cooker")).toEqual(["RHE-101"]);
    expect(names("chadar")).toEqual(["RHE-102"]);
    expect(names("brass diye")).toEqual(["RHE-119"]);
    expect(names("jute basket")).toEqual(["RHE-120"]);
    expect(matchProducts(["laptop"]).unmatched).toEqual(["laptop"]);
  });

  it("pauses nothing and asks when nothing matches", () => {
    const c = propose(ready(), { title: "Pause", action_type: "pause_unrestockable_listings" }).ctx;
    const { r, ctx: after } = run(c, "execute_mock_action", { type: "pause_unrestockable_listings", seller_consent_quote: "haan kar do", products: ["laptop"] });
    expect(r.response.not_executed).toBe(true);
    expect(String(r.response.reason)).toMatch(/Nothing was paused/);
    expect(after.actions[0].status).toBe("proposed");
  });

  it("pauses several named products and reports unmatched ones", () => {
    const c = propose(ready(), { title: "Pause", action_type: "pause_unrestockable_listings" }).ctx;
    const { ctx: after } = run(c, "execute_mock_action", { type: "pause_unrestockable_listings", seller_consent_quote: "haan", products: ["brass diya aur jute basket", "laptop"] });
    expect(after.actions[0].execution_lines?.filter((l) => l.includes(": paused"))).toHaveLength(2);
    expect(after.actions[0].execution_lines?.some((l) => l.includes("“laptop”: no matching listing"))).toBe(true);
  });
});

describe("insights come only from the seller", () => {
  it("rejects Priya's own notes and insights without the seller's words", () => {
    const c = run(base(), "run_diagnosis").ctx;
    const own = run(c, "record_seller_insight", { topic: "inventory", detail: "Cooker and bedsheets stock availability needs confirmation by seller", seller_words: "-" });
    expect(traceStatus(own.r.response)).toBe("blocked");
    expect(own.ctx.insights).toHaveLength(0);
    expect(traceStatus(run(c, "record_seller_insight", { topic: "pricing", detail: "Thinks price is too high" }).r.response)).toBe("blocked");
    expect(traceStatus(run(c, "record_seller_insight", { topic: "pricing", detail: "Thinks price is too high", seller_words: "price zyada hai shayad" }).r.response)).toBe("done");
  });

  it("rejects insights before the seller has said anything", () => {
    const c = { ...run(base(), "run_diagnosis").ctx, signals: {} };
    expect(traceStatus(run(c, "record_seller_insight", { topic: "other", detail: "x", seller_words: "y" }).r.response)).toBe("blocked");
  });
});

describe("no duplicate actions", () => {
  it("infers the action type from the title", () => {
    expect(inferActionType("Restock top 5 sellers")).toBe("generate_restock_list");
    expect(inferActionType("Generate restock list for top sellers")).toBe("generate_restock_list");
    expect(inferActionType("Pause copper bottle listing")).toBe("pause_unrestockable_listings");
    expect(inferActionType("Reactivate listings when stock arrives")).toBe("reactivate_listings_on_restock");
    expect(inferActionType("Call backup supplier")).toBeUndefined();
  });

  it("re-proposing the same kind of action updates it instead of adding another", () => {
    let c = propose(ready(), { title: "Restock top 5 sellers", action_type: "generate_restock_list" }).ctx;
    const second = propose(c, { title: "Generate restock list for top sellers" });
    c = second.ctx;
    expect(c.actions).toHaveLength(1);
    expect(c.actions[0].title).toBe("Generate restock list for top sellers");
    expect(second.r.response.updated_existing).toBe("Restock top 5 sellers");
    // Untyped near-duplicates merge too.
    c = propose(c, { title: "Call the backup supplier" }).ctx;
    c = propose(c, { title: "Call backup supplier today" }).ctx;
    expect(c.actions).toHaveLength(2);
  });
});

describe("not pushy: an offer that didn't get a yes isn't repeated", () => {
  it("records the declined offer and tells the model not to repeat it", () => {
    const c = propose(ready(), { title: "Restock", action_type: "generate_restock_list" }).ctx;
    const first = run(c, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "competitor sasta bech raha hai" });
    expect(traceStatus(first.r.response)).toBe("blocked");
    expect(first.ctx.declined_offers).toEqual(["generate_restock_list"]);
    expect(String(first.r.response.reason)).toMatch(/Do not repeat the offer/);
    const again = run(first.ctx, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "hmm" });
    expect(String(again.r.response.reason)).toMatch(/already passed on this offer/);
    // If the seller brings it up and says yes, it still works.
    expect(traceStatus(run(first.ctx, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan restock list bana do" }).r.response)).toBe("done");
  });
});

describe("wrap-up: never end in the same turn as 'kuch aur help chahiye?'", () => {
  it("tracks the question and the seller's answer from the transcript, across chunks", () => {
    const asked = signals([
      [{ kind: "seller_delta", text: "Monday theek hai" }, 1],
      [{ kind: "priya_delta", text: "Perfect. Kuch" }, 2],
      [{ kind: "priya_delta", text: " aur help chahiye?" }, 3],
    ]);
    expect(wrapUpState(asked)).toBe("awaiting_answer");
    expect(wrapUpState(updateSignals(asked, { kind: "seller_delta", text: "Nahi, bas itna hi" }, 4))).toBe("ok");
    expect(wrapUpState(signals([[{ kind: "seller_final", text: "Thank you Priya, bye" }, 1]]))).toBe("ok");
    expect(wrapUpState(signals([[{ kind: "seller_final", text: "Monday theek hai" }, 1]]))).toBe("not_asked");
  });

  it("blocks end_call_summary until the seller has answered", () => {
    const sameTurn = readyToEnd(signals([
      [{ kind: "seller_delta", text: "haan Monday theek hai" }, 1],
      [{ kind: "priya_delta", text: "Toh Monday baat karte hain. Kuch aur help chahiye?" }, 2],
    ]));
    const r = run(sameTurn, "end_call_summary", END_ARGS).r;
    expect(traceStatus(r.response)).toBe("blocked");
    expect(String(r.response.reason)).toMatch(/NOT answered yet/);
    expect(r.response.await_seller).toBe(true);

    const answered = { ...sameTurn, signals: updateSignals(sameTurn.signals, { kind: "seller_delta", text: "nahi bas, thank you" }, 3) };
    expect(traceStatus(run(answered, "end_call_summary", END_ARGS).r.response)).toBe("done");
  });

  it("blocks when the question was never asked", () => {
    const c = readyToEnd(signals([[{ kind: "seller_delta", text: "haan Monday theek hai" }, 1]]));
    expect(String(run(c, "end_call_summary", END_ARGS).r.response.reason)).toMatch(/Kuch aur help chahiye/);
  });
});

describe("prompt rules from the second real call", () => {
  const p = buildSystemPrompt({ mode: "inbound", memory: null, nowIso: NOW });
  it("has today's date, female grammar, listen-first, honesty on unknowns and no double turns", () => {
    expect(p).toContain("Today is Tuesday, 10 November 2026");
    expect(p).toContain("chahti hoon");
    expect(p).toContain("NEVER \"karta hoon\"");
    expect(p).toContain("LISTEN FIRST, DON'T PUSH");
    expect(p).toContain("at most ONCE");
    expect(p).toContain("You do NOT have competitor price data");
    expect(p).toContain("Never speak twice in a row");
    expect(p).toContain("Do NOT call end_call_summary in the same turn");
    expect(p).toContain("confirm all of them together in ONE short sentence");
  });
});
