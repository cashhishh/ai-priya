/**
 * Tests for the third real-call fixes: hidden system cues, Priya answering her
 * own question, competitor comparison, ≥3 actions, merged insights, seller
 * gender in the prompt, Hinglish WhatsApp text.
 */
import { describe, expect, it } from "vitest";
import { applyTranscriptOp, displayText, stripCues, type TranscriptEntry } from "@/lib/call-state";
import { estimateRecovery } from "@/lib/diagnose";
import { buildSystemPrompt } from "@/lib/prompts";
import { applyEventToContext } from "@/lib/tools/context";
import { executeTool, inferActionType, traceStatus } from "@/lib/tools/executor";
import { updateSignals } from "@/lib/tools/signals";
import { hinglishActionLine, hinglishIssue } from "@/lib/tools/summary";
import type { CallContext, ConversationSignals } from "@/lib/types";
import type { TranscriptOp } from "@/lib/voice/types";

const NOW = "2026-11-10T06:00:00.000Z"; // Tuesday 10 Nov 2026, IST

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
  c = run(c, "record_seller_insight", { topic: "supplier", detail: "Supplier delayed; restock by 20 Nov", seller_words: "bees tak" }).ctx;
  c = run(c, "record_seller_insight", { topic: "inventory", detail: "Copper bottle supplier shut", seller_words: "copper band" }).ctx;
  return c;
}

const sig = (ops: [TranscriptOp, number][]): ConversationSignals =>
  ops.reduce<ConversationSignals>((s, [op, at]) => updateSignals(s, op, at), {});

describe("system cues never reach the transcript", () => {
  it("strips cues, including one split across chunks or half-streamed", () => {
    expect(stripCues("[CALL_CONNECTED] Namaste Ramesh ji!")).toBe("Namaste Ramesh ji!");
    expect(stripCues("Namaste [CALL_CONN")).toBe("Namaste");
    expect(stripCues("Price [approx] hai")).toBe("Price [approx] hai"); // only UPPERCASE cues

    let t: TranscriptEntry[] = [];
    for (const text of ["[CALL_", "CONNECTED] ", "Namaste!"]) t = applyTranscriptOp(t, { kind: "priya_delta", text }, 0);
    expect(displayText(t[0])).toBe("Namaste!");
    t = applyTranscriptOp(t, { kind: "turn_complete" }, 1);
    expect(t[0].text).toBe("Namaste!");
  });

  it("drops a bubble that was only a cue", () => {
    let t = applyTranscriptOp([], { kind: "priya_delta", text: "[CALL_CONNECTED]" }, 0);
    t = applyTranscriptOp(t, { kind: "turn_complete" }, 1);
    expect(t).toHaveLength(0);
    expect(applyTranscriptOp([], { kind: "priya_full", text: "[CALL_CONNECTED]" }, 0)).toHaveLength(0);
  });
});

describe("Priya never answers her own question", () => {
  // Exactly the third call: Priya asks about Tuesday, then schedules without a reply.
  const askedTuesday = sig([
    [{ kind: "seller_delta", text: "haan restock list bana do" }, 1],
    [{ kind: "priya_delta", text: "Ho gaya. Kya hum agle Tuesday follow-up call kar sakte hain?" }, 2],
  ]);

  it("blocks schedule_follow_up until the seller answers, and asks the engine to mute Priya", () => {
    const { r, ctx } = run({ ...ready(), signals: askedTuesday }, "schedule_follow_up", { when: "next Tuesday", purpose: "Check" });
    expect(traceStatus(r.response)).toBe("blocked");
    expect(r.response.await_seller).toBe(true);
    expect(String(r.response.reason)).toMatch(/Never answer your own question/);
    expect(ctx.follow_up).toBeNull();
  });

  it("schedules once the seller agrees or names a day", () => {
    for (const reply of ["haan Tuesday theek hai", "chalega", "nahi, Wednesday rakh lo"]) {
      const s = updateSignals(askedTuesday, { kind: "seller_delta", text: reply }, 3);
      expect(traceStatus(run({ ...ready(), signals: s }, "schedule_follow_up", { when: "next Tuesday", purpose: "x" }).r.response), reply).toBe("done");
    }
  });

  it("needs a day or agreement in the seller's latest words", () => {
    const s = sig([[{ kind: "seller_delta", text: "competitor sasta bech raha hai" }, 1]]);
    const r = run({ ...ready(), signals: s }, "schedule_follow_up", { when: "next Monday", purpose: "x" }).r;
    expect(traceStatus(r.response)).toBe("blocked");
    expect(String(r.response.reason)).toMatch(/don't name a day or agree/);
  });

  it("blocks execute while a question is pending, unless the seller's last words were a yes", () => {
    const c = run(ready(), "propose_action", { title: "Restock", why: "x", owner: "seller", due_date: "2026-11-20", action_type: "generate_restock_list" }).ctx;
    const pending = sig([
      [{ kind: "seller_delta", text: "theek hai" }, 1],
      [{ kind: "priya_delta", text: "Main restock list ready kar doon?" }, 2],
    ]);
    const r = run({ ...c, signals: pending }, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan" }).r;
    expect(r.response.await_seller).toBe(true);

    const yesThenQuestion = sig([
      [{ kind: "seller_delta", text: "haan kar do" }, 1],
      [{ kind: "priya_delta", text: "Ek second. Aur supplier kab tak bhejega?" }, 2],
    ]);
    expect(traceStatus(run({ ...c, signals: yesThenQuestion }, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan kar do" }).r.response)).toBe("done");
  });
});

describe("competitor comparison is grounded in our catalogue", () => {
  it("out-of-stock product: the real issue is no stock", () => {
    const { r } = run(base(), "get_product_breakdown", { product: "pressure cooker", competitor_price_inr: 700 });
    const p = (r.response.products as Record<string, unknown>[])[0];
    expect(p).toMatchObject({ name: "Stainless Steel Pressure Cooker 3L", our_price_inr: 799, competitor_price_inr: 700, gap_inr: 99, stock_status: "out_of_stock" });
    expect(String(p.advice)).toMatch(/OUT OF STOCK.*Restock first/);
    expect(r.resultLine).toMatch(/ours ₹799 vs competitor ₹700, out of stock/);
  });

  it("in-stock and dearer: targeted coupon on that product, no catalogue-wide cut", () => {
    const { r } = run(base(), "get_product_breakdown", { product: "coffee mugs", competitor_price_inr: 450 });
    const p = (r.response.products as Record<string, unknown>[])[0];
    expect(p.gap_pct_of_our_price).toBe(18);
    expect(String(p.advice)).toMatch(/targeted coupon on this product alone.*don't cut prices across the catalogue/);
  });

  it("targeted_sku_deal is a 6th action type with an estimate and a per-product coupon", () => {
    expect(estimateRecovery("targeted_sku_deal").expected_recovery_inr).toBeGreaterThan(0);
    expect(inferActionType("Targeted coupon on the pressure cooker")).toBe("targeted_sku_deal");
    expect(inferActionType("Restock top sellers")).toBe("generate_restock_list");
    let c = run(ready(), "propose_action", { title: "Coupon on cooker", why: "competitor cheaper", owner: "seller", due_date: "2026-11-20", action_type: "targeted_sku_deal" }).ctx;
    c = run(c, "execute_mock_action", { type: "targeted_sku_deal", seller_consent_quote: "haan kar do", products: ["cooker"] }).ctx;
    expect(c.actions[0].status).toBe("executed");
    expect(c.actions[0].execution_lines).toEqual(["RHE-101 · Stainless Steel Pressure Cooker 3L: ₹799 → ₹719 with coupon (starts when restocked)"]);
  });
});

describe("insights merge instead of piling up", () => {
  it("rejects placeholders and updates an earlier insight on the same topic", () => {
    let c = run(base(), "run_diagnosis").ctx;
    const placeholder = run(c, "record_seller_insight", { topic: "competition", detail: "Competitor cheaper; product details pending", seller_words: "competitor sasta hai" });
    expect(traceStatus(placeholder.r.response)).toBe("blocked");
    c = run(c, "record_seller_insight", { topic: "competition", detail: "Competitor selling cheaper", seller_words: "competitor sasta bech raha hai" }).ctx;
    const merged = run(c, "record_seller_insight", { topic: "competition", detail: "Competitor selling pressure cooker cheaper at 700", seller_words: "cooker 700 mein" });
    expect(merged.r.response.merged_with_earlier).toBe(true);
    expect(merged.ctx.insights).toHaveLength(1);
    expect(merged.ctx.insights[0].detail).toBe("Competitor selling pressure cooker cheaper at 700");
  });
});

describe("WhatsApp summary in simple Hinglish", () => {
  it("maps issues and actions to Hinglish lines", () => {
    expect(hinglishIssue("Top sellers went out of stock (≈₹47.1k/month)")).toBe("Top-selling products out of stock ho gaye (≈₹47.1k/mahina ka nuksaan)");
    expect(hinglishIssue("Cancellations jumped")).toMatch(/^Cancellations 8% se 14% ho gaye/);
    expect(hinglishIssue("Competitor selling cheaper")).toMatch(/Competitor kuch products kam price par/);
    expect(hinglishIssue("Supplier se baat karni hai")).toBe("Supplier se baat karni hai");
    expect(
      hinglishActionLine({ id: "a", title: "Alerts", why: "", expected_recovery_inr: 4500, owner: "seller", due_date: "2026-11-16", status: "proposed", action_type: "enable_stock_alerts" }),
    ).toBe("⏳ Low-stock alert on karna · aapko karna hai, 16 Nov tak (~₹4.5k/mahina)");
  });
});

describe("prompt rules from the third real call", () => {
  const p = buildSystemPrompt({ mode: "inbound", memory: null, nowIso: NOW });
  it("covers cues, own-question answering, competitor steps, ≥3 actions and the seller's gender", () => {
    expect(p).toContain("NEVER say, repeat or echo anything in square brackets");
    expect(p).toContain("NEVER ANSWER YOUR OWN QUESTION");
    expect(p).toContain("call get_product_breakdown with product and competitor_price_inr");
    expect(p).toContain("at least THREE distinct");
    expect(p).toContain("THE SELLER IS A MAN");
    expect(p).toContain('"aap kar sakte hain"');
    expect(p).toContain("a man; use masculine forms");
  });
});
