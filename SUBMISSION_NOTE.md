# Priya: AI Virtual KAM · Submission Note

**What it is.** A browser voice agent that acts as a seller's Key Account Manager. When a seller says *"my sales dropped and I don't know why"*, Priya diagnoses the drop from their data, asks what the data can't show, agrees 2–3 actions with rupee impact, **executes** what she can on the call, books a follow-up and prepares a WhatsApp-ready summary for the seller to share.

## AI models
- **Gemini Live, `gemini-3.8-live` (native audio).** Real-time speech-to-speech with function calling and live transcription.
- **Gemini `gemini-3.6-flash`.** Text model for the fallback pipeline, with the same prompt and tools.
- **Deterministic diagnosis engine (TypeScript, unit-tested).** Computes every ₹ figure. The LLM may only quote tool outputs, so numbers are never hallucinated.

## Voice technology
- **Primary.** Browser ↔ Gemini Live over WebSocket using short-lived **ephemeral tokens** minted server-side (the API key never reaches the browser). 16 kHz mic capture via AudioWorklet, gapless 24 kHz playback, **barge-in** (seller can interrupt; playback stops instantly), auto-reconnect with session resumption.
- **Fallback (one toggle, one-click on failure).** Chrome speech recognition (en-IN) → Gemini text + tools → Indian TTS voice. Same UI and tools, so the demo never breaks.
- **Hinglish-native.** Mirrors Hindi, Hinglish or English, speaks numbers the Indian way, keeps turns to 1–3 sentences with one question at a time.

## Workflow
1. Greet and understand the concern in the seller's words.
2. **Diagnose before explaining.** Orders −32.5% with flat ₹500 ASP means a volume problem, so pricing is ruled out. Biggest issue: 13 more products out of stock, including top sellers (≈ ₹47k/month lost). Next: cancellations 8% → 14%, mostly "item unavailable" (≈ ₹8k + rating risk), likely lower visibility (inference), no deals this month (low confidence).
3. Ask what data can't show (supplier timeline, priority products, what can't be restocked) and record each answer.
4. Recommend prioritised actions with ₹ recovery: restock top sellers (~₹35.5k), pause unrestockable listings (~₹6k, protects rating), stock alerts, deal only after restock (~₹13.5k).
5. Execute on agreement (restock list with quantities, pause listings), schedule a follow-up, summarise, and send a WhatsApp-ready recap.

## Why it is an "owner" agent, not a Q&A bot
- **Drives the conversation.** It leads with the single most valuable finding and asks targeted follow-ups.
- **Turns talk into commitments.** Every recommendation becomes an action with an owner, a due date and ₹ impact; some are executed live.
- **Closes the loop.** A follow-up is booked and memory persists; the **Follow-up mode** opens with *"Last time you said the supplier would restock by the 20th. Did it arrive?"* and compares progress. **Proactive mode** calls the seller first.
- **Guardrails in code, not just in the prompt.** It can't recommend before diagnosing and asking at least 2 questions, can't act without an explicit "haan / kar do", can't end with fewer than 3 actions or without a recap and "kuch aur help chahiye?", and never claims to have sent anything. It also can't answer its own question (actions that assume the seller's reply are refused, and Priya is muted until the seller speaks), can't end the call in the same breath as asking "kuch aur help?" (the transcript is checked), re-push an offer the seller passed on, pause products the seller didn't name, or record its own notes as seller insights. Follow-up dates like "next Monday" are resolved in code against today's date in India.
- **Knows its limits.** It escalates to a human KAM for anger, payments or policy issues, and labels estimates and inferences.
- **Transparent.** A live "Agent brain" timeline shows every tool call and result; the Seller 360 panel updates as issues, insights and actions appear.

## Assumptions
Given metrics are used exactly. Added (and shown in-app): seller Ramesh Kumar, Home & Kitchen, Jaipur, 3 years, 60 listings; 20 SKUs + long tail that reconcile **exactly** with the given totals; most cancellations are "item unavailable"; no price changes, deals or ads; competitor deals are an assumption; follow-up progress is simulated; actions are mocked.

**Cost:** ≈ ₹11–32 per 4-minute Live call; ≈ ₹7 on fallback. **Run:** `npm i`, add `GEMINI_API_KEY` to `.env.local`, `npm run dev`, open in Chrome.
