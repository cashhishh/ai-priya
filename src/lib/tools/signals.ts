/**
 * Conversation signals derived from the live transcript.
 *
 * The model's own claim that "the seller declined more help" isn't enough:
 * in a real call Priya asked "Kuch aur help chahiye?" and ended the call in
 * the same breath. These signals record WHEN Priya asked and WHEN the seller
 * last spoke, so the end-call guard can require a real answer in between.
 */
import { joinChunks } from "@/lib/call-state";
import type { ConversationSignals } from "@/lib/types";
import type { TranscriptOp } from "@/lib/voice/types";

/** "Kuch aur help chahiye?", "Anything else?", in Latin or Devanagari script. */
export const HELP_QUESTION_RE =
  /(kuch aur|kuchh aur|aur kuch|aur kuchh|koi aur|aur koi|anything else|something else|कुछ और|और कुछ|और कोई|कोई और)/i;

/** The seller wrapping up on their own ("bas itna hi", "thank you, bye"). */
export const SELLER_GOODBYE_RE =
  /(\b(bye|alvida|thank you|thanks|thank u|thankyou|shukriya|dhanyavaad|dhanyawad|bas itna|itna hi|that'?s all|nothing else|kuch nahi|kuchh nahi|nahi chahiye|no thanks|all good|sab theek)\b|धन्यवाद|शुक्रिया|बस इतना|कुछ नहीं|नहीं चाहिए)/i;

const hasWords = (t: string) => /[\p{L}\p{N}]{2,}/u.test(t);
const tail = (s: string, n = 200) => (s.length > n ? s.slice(-n) : s);

export function updateSignals(prev: ConversationSignals | undefined, op: TranscriptOp, now: number): ConversationSignals {
  const s: ConversationSignals = { ...(prev ?? {}) };
  switch (op.kind) {
    case "seller_delta":
    case "seller_final": {
      if (!hasWords(op.text)) return s;
      // A new seller utterance starts once Priya has spoken since the last one.
      const continuing = !s.priya_tail;
      s.last_seller_text = tail(continuing && s.last_seller_text ? `${s.last_seller_text} ${op.text}` : op.text);
      s.seller_spoke_at = now;
      s.priya_tail = "";
      return s;
    }
    case "priya_delta":
    case "priya_full": {
      // Live streams word pieces ("Ku" + "ch aur"), fallback sends whole messages.
      const joined = op.kind === "priya_delta" ? joinChunks(s.priya_tail ?? "", op.text) : `${s.priya_tail ?? ""} ${op.text}`;
      s.priya_tail = tail(joined.replace(/\s+/g, " "));
      if (HELP_QUESTION_RE.test(s.priya_tail)) s.help_asked_at = now;
      if (/[?？]/.test(op.text)) s.priya_question_at = now;
      return s;
    }
    default:
      return s;
  }
}

/** Priya asked a question and the seller hasn't spoken since. */
export function questionPending(signals: ConversationSignals | undefined): boolean {
  if (!signals?.priya_question_at) return false;
  return signals.priya_question_at >= (signals.seller_spoke_at ?? 0);
}

/** "Haan", "theek hai", "chalega", "ok", "done": agreement to a suggested plan (e.g. a date). */
export const AGREEMENT_RE =
  /(\b(haan|haa|han|hanji|haanji|ha ji|ok|okay|theek|thik|chalega|chalo|done|sure|yes|yeah|bilkul|zaroor|perfect|fine|sahi|kar lo|kar lena|rakh lo|rakh do|fix)\b|हाँ|हां|ठीक|चलेगा|बिल्कुल|ज़रूर|जरूर)/i;

export type WrapUpState = "ok" | "awaiting_answer" | "not_asked";

/**
 * Has the seller actually answered the "anything else?" question (or said
 * goodbye on their own)? Unknown signals (e.g. old clients) are treated as ok.
 */
export function wrapUpState(signals: ConversationSignals | undefined): WrapUpState {
  if (!signals) return "ok";
  const asked = signals.help_asked_at ?? 0;
  const spoke = signals.seller_spoke_at ?? 0;
  if (asked && asked >= spoke) return "awaiting_answer";
  if (asked && spoke > asked) return "ok";
  if (SELLER_GOODBYE_RE.test(signals.last_seller_text ?? "")) return "ok";
  return "not_asked";
}
