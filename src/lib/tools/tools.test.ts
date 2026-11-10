import { describe, expect, it } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { applyTranscriptOp, callReducer, initialCallState, joinChunks, type TranscriptEntry } from "@/lib/call-state";
import { cleanForSpeech, runChatTurn } from "@/lib/fallback/chat-loop";
import { applyEventToContext } from "@/lib/tools/context";
import { FUNCTION_DECLARATIONS, LIVE_FUNCTION_DECLARATIONS, TOOL_NAMES, liveScheduling } from "@/lib/tools/declarations";
import { executeTool, normalizeDate, traceStatus } from "@/lib/tools/executor";
import { classifyConsent } from "@/lib/tools/guards";
import { buildSummary } from "@/lib/tools/summary";
import { buildSystemPrompt } from "@/lib/prompts";
import { sampleMemory } from "@/lib/memory";
import type { CallContext } from "@/lib/types";
import type { TranscriptOp } from "@/lib/voice/types";

const ctx = (over: Partial<CallContext> = {}): CallContext => ({
  mode: "inbound",
  insights: [],
  actions: [],
  follow_up: null,
  memory: null,
  now_iso: "2026-11-10T06:00:00.000Z",
  ...over,
});

/** Run a tool and fold its events into the context, like both engines do. */
function run(c: CallContext, name: string, args: Record<string, unknown> = {}) {
  const r = executeTool(name, args, c);
  let next = c;
  for (const e of r.events) next = applyEventToContext(next, e);
  return { r, ctx: next };
}

/** A context that has diagnosed and asked enough questions to recommend. */
function readyToRecommend(): CallContext {
  let c = run(ctx(), "run_diagnosis").ctx;
  c = run(c, "record_seller_insight", { topic: "supplier", detail: "Supplier delayed; restock by the 20th", seller_words: "supplier ka delay hai, bees tak aa jayega" }).ctx;
  c = run(c, "record_seller_insight", { topic: "inventory", detail: "Copper bottle supplier has stopped", seller_words: "copper bottle ka supplier band ho gaya" }).ctx;
  return c;
}

const propose = (c: CallContext, action_type: string, title = "Action") =>
  run(c, "propose_action", { title, why: "x", expected_recovery_inr: 999999, owner: "seller", due_date: "2026-11-20", action_type });

describe("tool declarations", () => {
  it("declares all 9 tools; Live: bookkeeping tools NON_BLOCKING (+SILENT), the rest BLOCKING; fallback has no behavior", () => {
    expect(FUNCTION_DECLARATIONS.map((d) => d.name)).toEqual([...TOOL_NAMES]);
    const behavior = Object.fromEntries(LIVE_FUNCTION_DECLARATIONS.map((d) => [d.name, d.behavior]));
    expect(behavior.record_seller_insight).toBe("NON_BLOCKING");
    expect(behavior.propose_action).toBe("NON_BLOCKING");
    for (const n of ["run_diagnosis", "get_product_breakdown", "execute_mock_action", "schedule_follow_up", "end_call_summary"]) expect(behavior[n], n).toBe("BLOCKING");
    expect(liveScheduling("record_seller_insight")).toBe("SILENT");
    expect(liveScheduling("run_diagnosis")).toBeUndefined();
    expect(FUNCTION_DECLARATIONS.every((d) => d.behavior === undefined)).toBe(true);
  });
});

describe("executeTool()", () => {
  it("run_diagnosis returns ranked issues + recovery estimates and marks the call diagnosed", () => {
    const { r, ctx: c } = run(ctx(), "run_diagnosis");
    expect(r.resultLine).toMatch(/4 issues, biggest: stock-outs ≈ ₹47.1k\/month/);
    expect((r.response.recovery_estimates as unknown[]).length).toBe(6);
    expect(c.diagnosed).toBe(true);
  });

  it("propose_action uses the official ₹ estimate, not the model's number", () => {
    const { r } = propose(readyToRecommend(), "generate_restock_list");
    expect(r.response.expected_recovery_inr).toBe(35500);
  });

  it("propose_action without an action_type carries no ₹ figure", () => {
    const { r } = run(readyToRecommend(), "propose_action", { title: "Call backup supplier", why: "x", expected_recovery_inr: 50000, owner: "seller", due_date: "2026-11-12" });
    expect(r.response.expected_recovery_inr).toBe(0);
  });

  it("execute_mock_action marks the matching proposal executed", () => {
    let c = propose(readyToRecommend(), "pause_unrestockable_listings").ctx;
    const x = run(c, "execute_mock_action", { type: "pause_unrestockable_listings", seller_consent_quote: "haan, kar do", products: ["copper bottle"] });
    c = x.ctx;
    expect(traceStatus(x.r.response)).toBe("done");
    expect(c.actions).toHaveLength(1);
    expect(c.actions[0].status).toBe("executed");
    // ONLY the product the seller named, not every long-standing stock-out.
    expect(c.actions[0].execution_lines).toEqual(["RHE-107 · Copper Water Bottle 1L: paused (11 days out of stock)"]);
    expect(c.actions[0].execution_result).toMatch(/1 listing the seller named: Copper Water Bottle 1L/);
    expect(String(x.r.response.how_to_say)).toMatch(/ready kar diya/);
  });

  it("reactivate_listings_on_restock has an estimate and a mock payload", () => {
    let c = propose(readyToRecommend(), "reactivate_listings_on_restock").ctx;
    expect(c.actions[0].expected_recovery_inr).toBe(7500);
    c = run(c, "execute_mock_action", { type: "reactivate_listings_on_restock", seller_consent_quote: "yes please do it" }).ctx;
    expect(c.actions[0].status).toBe("executed");
  });

  it("end_call_summary lists ALL actions with status and at least 2 issues", () => {
    let c = readyToRecommend();
    c = propose(c, "generate_restock_list", "Restock top sellers").ctx;
    c = propose(c, "enroll_in_deal", "Deal on in-stock products").ctx;
    c = propose(c, "enable_stock_alerts", "Turn on stock alerts").ctx;
    c = run(c, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan kar do" }).ctx;
    c = run(c, "schedule_follow_up", { date: "2026-11-17", purpose: "Check restock" }).ctx;
    const { r } = run(c, "end_call_summary", { issues: ["Stock-outs"], actions: ["Restock"], next_steps: ["Call on 17 Nov"], seller_declined_more_help: true });
    const ev = r.events[0];
    expect(ev.type).toBe("summary_ready");
    if (ev.type !== "summary_ready") return;
    expect(ev.summary.issues.length).toBeGreaterThanOrEqual(2);
    expect(ev.summary.actions).toHaveLength(3);
    expect(ev.summary.actions[0]).toMatch(/Restock top sellers.*done/);
    expect(ev.summary.actions[1]).toMatch(/Deal on in-stock products.*to do by/);
    expect(ev.summary.whatsapp_url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(ev.summary.whatsapp_text).toContain("✅ Top-selling products ka stock wapas mangwana · ho gaya");
    expect(ev.summary.whatsapp_text).toContain("⏳ Stock aane ke baad deal mein judna · aapko karna hai");
    expect(ev.summary.whatsapp_text).toContain("Top-selling products out of stock ho gaye");
    expect(String(r.response.instruction)).toMatch(/Never say you sent it/);
  });

  it("follow-up metrics include simulated progress from memory", () => {
    const { r } = run(ctx({ mode: "follow_up", memory: sampleMemory(new Date("2026-11-10")) }), "get_seller_metrics");
    expect(r.response.progress_since_last_call).toBeDefined();
  });

  it("handles unknown tools and bad args without throwing", () => {
    expect(executeTool("nope", {}, ctx()).response.error).toBeDefined();
    expect(executeTool("record_seller_insight", { topic: 5 }, ctx()).response.error).toBeDefined();
  });

  it("normalizes dates and falls back for garbage", () => {
    expect(normalizeDate("2026-11-20", "2026-11-10T00:00:00Z")).toBe("2026-11-20");
    expect(normalizeDate("someday", "2026-11-10T00:00:00Z", 7)).toBe("2026-11-17");
  });
});

describe("guardrails in code", () => {
  it("consent: only an explicit yes counts", () => {
    for (const yes of [
      "haan",
      "haan kar do",
      "Kar do",
      "yes",
      "theek hai kar do",
      "bilkul",
      "हाँ कर दो",
      // "nahi" here describes products, not a refusal (this is the demo script's line):
      "Haan, restock list abhi bana do, aur jo restock nahi ho sakti unki listing pause kar do",
      "no problem, kar do",
    ])
      expect(classifyConsent(yes), yes).toBe("yes");
    for (const no of ["nahi, bas theek hai", "bas theek hai", "abhi nahi", "baad mein", "no", "nahi", "नहीं", "नहीं, रहने दो", "haan but abhi nahi"])
      expect(classifyConsent(no), no).toBe("no");
    for (const unclear of ["theek hai", "hmm", "", "achha"]) expect(classifyConsent(unclear), unclear).toBe("ambiguous");
  });

  it("blocks propose_action before diagnosis or before enough insights", () => {
    expect(traceStatus(propose(ctx(), "generate_restock_list").r.response)).toBe("blocked");
    const diagnosedOnly = run(ctx(), "run_diagnosis").ctx;
    const r = propose(diagnosedOnly, "generate_restock_list").r;
    expect(traceStatus(r.response)).toBe("blocked");
    expect(String(r.response.reason)).toMatch(/follow-up question/);
  });

  it("blocks execute_mock_action without a proposal, without consent, or twice", () => {
    const c = readyToRecommend();
    expect(traceStatus(run(c, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan" }).r.response)).toBe("blocked");
    const proposed = propose(c, "generate_restock_list").ctx;
    const refused = run(proposed, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "nahi, bas theek hai" });
    expect(traceStatus(refused.r.response)).toBe("blocked");
    expect(refused.ctx.actions[0].status).toBe("proposed");
    expect(traceStatus(run(proposed, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "theek hai" }).r.response)).toBe("blocked");
    const done = run(proposed, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan kar do" }).ctx;
    expect(traceStatus(run(done, "execute_mock_action", { type: "generate_restock_list", seller_consent_quote: "haan" }).r.response)).toBe("blocked");
  });

  it("blocks end_call_summary with fewer than 3 actions, no follow-up, or no 'kuch aur?' check", () => {
    let c = propose(propose(readyToRecommend(), "generate_restock_list").ctx, "enroll_in_deal").ctx;
    const args = { issues: ["a", "b"], actions: ["x"], next_steps: ["y"], seller_declined_more_help: true };
    const two = run(c, "end_call_summary", args).r;
    expect(traceStatus(two.response)).toBe("blocked");
    expect(String(two.response.reason)).toMatch(/at least 3/);
    // A follow-up call only needs 2 (the plan exists from last time).
    expect(String(run({ ...c, mode: "follow_up" }, "end_call_summary", args).r.response.reason)).not.toMatch(/at least/);

    c = propose(c, "enable_stock_alerts").ctx;
    expect(String(run(c, "end_call_summary", args).r.response.reason)).toMatch(/follow-up/);
    expect(traceStatus(run(c, "end_call_summary", { ...args, follow_up_declined: true }).r.response)).toBe("done");

    c = run(c, "schedule_follow_up", { date: "2026-11-17", purpose: "Check" }).ctx;
    expect(String(run(c, "end_call_summary", { ...args, seller_declined_more_help: false }).r.response.reason)).toMatch(/Kuch aur help chahiye/);
  });

  it("an escalated call may end without a full plan", () => {
    const c = run(ctx(), "escalate_to_human_kam", { reason: "Payment dispute" }).ctx;
    expect(traceStatus(run(c, "end_call_summary", { issues: [], actions: [], next_steps: [], seller_declined_more_help: false }).r.response)).toBe("done");
  });
});

describe("summary", () => {
  it("tops up issues to at least 2 from the diagnosis without duplicating", () => {
    const s = buildSummary({ issues: ["Top sellers out of stock"], modelActions: [], nextSteps: [], followUp: null, actionItems: [], createdAt: "2026-11-10" });
    expect(s.issues).toHaveLength(2);
    expect(s.issues[1]).toMatch(/visibility/i);
  });
});

describe("prompts", () => {
  it("includes memory only in follow-up mode, and the new behaviour rules", () => {
    const mem = sampleMemory(new Date("2026-11-10"));
    const follow = buildSystemPrompt({ mode: "follow_up", memory: mem, nowIso: "2026-11-10T00:00:00Z" });
    const inbound = buildSystemPrompt({ mode: "inbound", memory: null, nowIso: "2026-11-10T00:00:00Z" });
    expect(follow).toContain("MEMORY FROM THE LAST CALL");
    expect(inbound).not.toContain("MEMORY FROM THE LAST CALL");
    expect(inbound).toContain("CONSENT BEFORE ACTING");
    expect(inbound).toContain("Kuch aur help chahiye?");
    expect(inbound).toContain("never \"maine bhej diya\"");
  });
});

describe("fallback chat loop (mocked model)", () => {
  it("runs tool calls, returns a cleaned reply, UI events and full history", async () => {
    const replies = [
      {
        candidates: [{ content: { role: "model", parts: [{ functionCall: { id: "c1", name: "run_diagnosis", args: {} }, thoughtSignature: "sig" }] } }],
        functionCalls: [{ id: "c1", name: "run_diagnosis", args: {} }],
        text: undefined,
      },
      {
        candidates: [{ content: { role: "model", parts: [{ text: "**Ramesh ji**, sales ₹65,000 down hai." }] } }],
        functionCalls: undefined,
        text: "**Ramesh ji**, sales ₹65,000 down hai.",
      },
    ];
    let call = 0;
    const fakeAi = { models: { generateContent: async () => replies[call++] } } as unknown as GoogleGenAI;
    const res = await runChatTurn({ ai: fakeAi, model: "m", history: [], message: "sales kyun gir gayi?", context: ctx() });
    expect(res.reply).toBe("Ramesh ji, sales rupees 65,000 down hai.");
    expect(res.uiEvents.map((e) => e.type)).toEqual(["diagnosis"]);
    expect(res.traces[0].status).toBe("done");
    expect(res.history).toHaveLength(4);
    expect(res.history[1].parts?.[0].thoughtSignature).toBe("sig");
    expect(res.history[2].parts?.[0].functionResponse?.id).toBe("c1");
  });

  it("strips leaked cues and markdown for speech", () => {
    expect(cleanForSpeech("[CALL_CONNECTED] - **Hello**")).toBe("Hello");
  });
});

describe("transcript assembly", () => {
  const apply = (ops: [TranscriptOp, number][]): TranscriptEntry[] => ops.reduce<TranscriptEntry[]>((t, [op, at]) => applyTranscriptOp(t, op, at), []);
  const roles = (t: TranscriptEntry[]) => t.map((e) => e.role);

  it("keeps the greeting on top even if the seller talks before its turn completes", () => {
    const t = apply([
      [{ kind: "priya_delta", text: "Namaste! Main Priya." }, 0],
      [{ kind: "seller_interim", text: "meri sales" }, 1000],
      [{ kind: "seller_delta", text: "Meri sales gir gayi" }, 1500],
    ]);
    expect(roles(t)).toEqual(["priya", "seller"]);
    expect(t[0].text).toBe("Namaste! Main Priya.");
  });

  it("each Priya turn (and each tool-call boundary) is its own bubble", () => {
    const t = apply([
      [{ kind: "priya_delta", text: "Ek second, data dekh rahi hoon." }, 0],
      [{ kind: "priya_break" }, 100],
      [{ kind: "priya_delta", text: "Ramesh ji, orders kam hue hain." }, 900],
      [{ kind: "turn_complete" }, 2000],
      [{ kind: "priya_delta", text: "Ek sawaal." }, 2100],
    ]);
    expect(t.map((e) => e.text)).toEqual(["Ek second, data dekh rahi hoon.", "Ramesh ji, orders kam hue hain.", "Ek sawaal."]);
  });

  it("joins chunks with a space after punctuation", () => {
    expect(joinChunks("hai.", "Ramesh")).toBe("hai. Ramesh");
    expect(joinChunks("Nam", "aste")).toBe("Namaste");
    expect(joinChunks("hai. ", "Ramesh")).toBe("hai. Ramesh");
  });

  it("puts a late seller transcript before a reply that just started", () => {
    const t = apply([
      [{ kind: "priya_delta", text: "Namaste!" }, 0],
      [{ kind: "turn_complete" }, 500],
      [{ kind: "seller_delta", text: "Sales kam hai." }, 3000],
      [{ kind: "turn_complete" }, 3500],
      [{ kind: "priya_delta", text: "Achha, " }, 6000],
      [{ kind: "seller_delta", text: "Help karo" }, 6800],
    ]);
    expect(roles(t)).toEqual(["priya", "seller", "seller", "priya"]);
  });

  it("marks Priya interrupted on barge-in and keeps any script as-is", () => {
    let t = apply([[{ kind: "priya_delta", text: "Dekhiye, aapke top" }, 0]]);
    t = applyTranscriptOp(t, { kind: "interrupted" }, 100);
    t = applyTranscriptOp(t, { kind: "seller_delta", text: "मेरा supplier late है" }, 200);
    expect(t[0].interrupted).toBe(true);
    expect(t[1].text).toBe("मेरा supplier late है");
  });

  it("ignores late status updates after the call ended", () => {
    let s = callReducer(initialCallState(), { type: "start", mode: "inbound", engine: "live", memory: null, at: 1 });
    s = callReducer(s, { type: "ended", at: 2, summary: null });
    s = callReducer(s, { type: "status", status: "listening" });
    expect(s.status).toBe("ended");
  });
});
