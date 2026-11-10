/**
 * Code-level guardrails for agent behaviour.
 *
 * Prompts tell Priya what to do; these guards make the important rules hold
 * even when the model slips. A blocked tool call returns
 * `{ ok: false, blocked: true, reason }`. The model reads the reason and
 * corrects itself, and the Agent Brain timeline shows the call as "blocked".
 */
import type { ActionType, CallContext } from "@/lib/types";
import { resolveDate } from "@/lib/dates";
import { AGREEMENT_RE, questionPending, wrapUpState } from "./signals";

export type Consent = "yes" | "no" | "ambiguous";

// Latin-script Hindi/Hinglish/English. Word boundaries stop "no" from matching "now".
/** Phrases that refuse or postpone the action wherever they appear. */
const REFUSAL_PHRASE_LATIN =
  /\b(mat (karo|kariye|kijiye|karna)|nahi chahiye|nahin chahiye|abhi nahi|abhi nahin|rehne do|bas theek hai|bas thik hai|baad (me|mein|main)|zaroorat nahi|not now|later|don'?t|do not|no thanks|ruk(o|iye|na)|wait|chhodo|chodo)\b/i;
/** A reply that STARTS with no ("nahi, ..."). A "nahi" mid-sentence can just describe products. */
const LEADING_NO_LATIN = /^\W*(nahi|nahin|nai|nah|no|nope)\b/i;
/** A bare no anywhere, used only when there is no explicit yes. */
const ANY_NO_LATIN = /\b(nahi|nahin|no|nope)\b/i;
const CONSENT_LATIN =
  /\b(haan|haa|han|hanji|haanji|ji haan|ha ji|yes|yeah|yep|sure|kar do|kardo|kar dijiye|kar dijie|kar dena|kariye|karo|kar lo|bana do|bana dijiye|go ahead|please do|do it|bilkul|zaroor|theek hai kar|thik hai kar|ok kar|okay kar|chalo kar)\b/i;
/** Polite phrases containing "no"/"nahi" that are not refusals. */
const NOT_A_REFUSAL = /\b(no problem|koi baat nahi|koi problem nahi|no issues?)\b/gi;
// Devanagari (\b doesn't work for these scripts, so plain substring matches).
const REFUSAL_PHRASE_DEVANAGARI = /(मत कर|नहीं चाहिए|अभी नहीं|रहने दो|बस ठीक है|बाद में|रुको|रुकिए)/;
const LEADING_NO_DEVANAGARI = /^[\s,.!]*(नहीं|नही)/;
const ANY_NO_DEVANAGARI = /(नहीं|नही)/;
const CONSENT_DEVANAGARI = /(हाँ|हां|हा जी|जी हाँ|कर दो|कर दीजिए|कर दीजिये|करो|बना दो|बिल्कुल|ज़रूर|जरूर|ठीक है कर)/;

/**
 * Classify the seller's words when asked "shall I do it?".
 *  1. Explicit refusal or postponement anywhere ("bas theek hai", "abhi nahi") → no
 *  2. Reply starts with no ("nahi, ...") → no
 *  3. Explicit yes ("haan", "kar do") → yes, even if "nahi" appears elsewhere,
 *     e.g. "jo restock nahi ho sakti unki listing pause kar do"
 *  4. A bare no with no yes → no; anything else (a plain "theek hai", "hmm") → ambiguous
 */
export function classifyConsent(quote: string): Consent {
  const q = quote.trim().replace(NOT_A_REFUSAL, " ");
  if (!q.trim()) return "ambiguous";
  if (REFUSAL_PHRASE_LATIN.test(q) || REFUSAL_PHRASE_DEVANAGARI.test(q)) return "no";
  if (LEADING_NO_LATIN.test(q) || LEADING_NO_DEVANAGARI.test(q)) return "no";
  if (CONSENT_LATIN.test(q) || CONSENT_DEVANAGARI.test(q)) return "yes";
  if (ANY_NO_LATIN.test(q) || ANY_NO_DEVANAGARI.test(q)) return "no";
  return "ambiguous";
}

export interface Blocked {
  ok: false;
  blocked: true;
  reason: string;
}

const block = (reason: string): Blocked => ({ ok: false, blocked: true, reason });

/** Minimum seller insights before recommending: ask before you prescribe. */
export function minInsightsBeforeRecommending(ctx: CallContext): number {
  return ctx.mode === "follow_up" ? 1 : 2;
}

export function guardProposeAction(ctx: CallContext): Blocked | null {
  if (ctx.escalated) return null;
  if (!ctx.diagnosed) {
    return block("Run run_diagnosis before recommending anything, so recommendations are grounded in the seller's numbers.");
  }
  const need = minInsightsBeforeRecommending(ctx);
  if (ctx.insights.length < need) {
    return block(
      `Only ${ctx.insights.length} seller insight(s) recorded; need at least ${need} before recommending. Ask the seller a short follow-up question (one per turn), e.g. when stock will arrive, which products matter most, what can't be restocked, or why orders were cancelled. Record each answer with record_seller_insight, then recommend.`,
    );
  }
  return null;
}

export function guardExecute(ctx: CallContext, type: ActionType, consentQuote: string): Blocked | null {
  const proposal = ctx.actions.find((a) => a.action_type === type);
  if (!proposal) {
    return block(
      `"${type}" has not been proposed yet. First explain it and add it with propose_action (action_type "${type}"), then ask the seller if you should do it now.`,
    );
  }
  if (proposal.status === "executed") {
    return block(`"${type}" was already executed earlier in this call. Do not repeat it; tell the seller it's already done.`);
  }
  const consent = classifyConsent(consentQuote);
  if (consent === "yes") return null;
  const alreadyDeclined = ctx.declined_offers?.includes(type);
  const dontPush =
    "Do not repeat the offer. Answer whatever the seller actually asked, and only bring this up again if the seller does.";
  if (consent === "no" || alreadyDeclined) {
    return block(
      `The seller's words ("${consentQuote || "nothing quoted"}") are not a yes${alreadyDeclined ? ", and they already passed on this offer earlier" : ""}. Do NOT execute. Acknowledge their choice in a few words. ${dontPush} If you already asked them a question, say nothing more and wait.`,
    );
  }
  return block(
    `The seller's words ("${consentQuote || "nothing quoted"}") are not an explicit yes. Do NOT execute. If the seller's reply was about something else, answer that instead and drop the offer. Only if they seemed to be agreeing, ask once: "Toh main abhi ready kar doon?" ${dontPush}`,
  );
}

const WAIT_FOR_SELLER =
  "You asked the seller a question and they have NOT answered yet. Never answer your own question or assume their answer. Say nothing more now; end your turn and wait for the seller to speak.";

/**
 * Tools that assume the seller's answer (execute, schedule, end) must not run
 * while Priya's last question is still unanswered. For execute, a clear yes as
 * the seller's latest words is enough (Priya may have added a question after it).
 */
export function guardAwaitingSeller(ctx: CallContext, kind: "execute" | "schedule" | "end"): Blocked | null {
  if (!questionPending(ctx.signals)) return null;
  if (kind === "execute" && classifyConsent(ctx.signals?.last_seller_text ?? "") === "yes") return null;
  return block(WAIT_FOR_SELLER);
}

/** schedule_follow_up needs the seller to have named a day/date or agreed to the suggested one. */
export function guardScheduleFollowUp(ctx: CallContext): Blocked | null {
  const pending = guardAwaitingSeller(ctx, "schedule");
  if (pending) return pending;
  const s = ctx.signals;
  if (!s) return null; // no transcript signals (e.g. old client): rely on the prompt
  const last = s.last_seller_text ?? "";
  if (resolveDate(last, ctx.now_iso) || AGREEMENT_RE.test(last)) return null;
  return block(
    `The seller's latest words ("${last || "nothing yet"}") don't name a day or agree to one. Suggest a day in one short question, then STOP and wait. Call schedule_follow_up only after the seller names a day or agrees.`,
  );
}

/** Distinct actions needed before ending: 3 normally, 2 in a follow-up call (the plan already exists). */
export function minActionsBeforeEnding(ctx: CallContext): number {
  return ctx.mode === "follow_up" ? 2 : 3;
}

export function guardEndCall(ctx: CallContext, sellerDeclinedMoreHelp: boolean, followUpDeclined: boolean): Blocked | null {
  if (ctx.escalated) return null; // escalated calls hand over to a human; no plan required
  const need = minActionsBeforeEnding(ctx);
  if (ctx.actions.length < need) {
    return block(
      `Only ${ctx.actions.length} action(s) proposed. Before ending, propose at least ${need} distinct, prioritised actions with propose_action (each with an action_type so it has an official ₹ estimate), chosen from what the seller told you: e.g. restock top sellers, pause listings they can't restock, low-stock alerts, a deal after restock, a targeted coupon on a competitor-pressured product. Explain one or two per turn and offer each only once.`,
    );
  }
  if (!ctx.follow_up && !followUpDeclined) {
    return block("No follow-up agreed. Propose a follow-up date, confirm it with the seller, and call schedule_follow_up before ending.");
  }
  const wrap = wrapUpState(ctx.signals);
  if (wrap === "awaiting_answer") {
    return block(
      'You just asked "Kuch aur help chahiye?" and the seller has NOT answered yet. Stop talking now and wait for their answer. Call end_call_summary only after they reply with a no or a goodbye.',
    );
  }
  if (!sellerDeclinedMoreHelp || wrap === "not_asked") {
    return block(
      'Before ending: give a brief spoken recap (1–2 issues and the agreed actions), confirm the follow-up date, ask "Kuch aur help chahiye?", then STOP and wait. Call end_call_summary only in a later turn, after the seller declines or says goodbye.',
    );
  }
  return null;
}
