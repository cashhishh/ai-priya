# Priya · AI Virtual KAM

A **voice-first AI Key Account Manager** for marketplace sellers. A seller calls and says *"My sales have dropped significantly this month. I don't understand why. Can you help me?"* Priya listens, diagnoses the drop from the seller's data, asks the questions the data can't answer, recommends and **executes** fixes, books a follow-up, and sends a WhatsApp-ready summary.

Priya is built to **own the seller's problem**, not just answer questions: every recommendation is grounded in deterministic numbers, tracked as an action with an owner and a date, and followed up on the next call.

---

## Highlights

| | |
|---|---|
| 🎙️ **Real-time native-audio voice** | Gemini Live (`gemini-3.8-live`) over a WebSocket from the browser: natural prosody, low latency, **barge-in** (interrupt her mid-sentence), live transcripts both ways. |
| 🛟 **Never-break fallback** | One toggle switches to browser speech recognition (en-IN) → Gemini text model with the **same prompt and tools** → Indian TTS voice. If Live fails, a one-click "Switch to Fallback" redials. |
| 🧮 **Grounded diagnosis** | A unit-tested TypeScript engine (not the LLM) computes issues ranked by ₹ impact and ₹ recovery per action. The model may only quote tool numbers. |
| 🧠 **Visible agent brain** | Every tool call streams into a live timeline with a readable result ("run_diagnosis → 4 issues, biggest: stock-outs ≈ ₹47.1k/month"). |
| ✅ **Acts, not just advises** | Generates a restock list, pauses unrestockable listings, turns on stock alerts, enrols in a deal (mocked), schedules a follow-up, escalates to a human. |
| 🔁 **Memory + 3 call modes** | Inbound (assignment scenario), Proactive (Priya calls first with the biggest finding), Follow-up (opens with last call's commitments and compares progress). |
| 💬 **Hinglish-native** | Mirrors Hindi / Hinglish / English, speaks numbers like a person ("ek lakh paintees hazaar"), WhatsApp summary in Hinglish. |

---

## Quick start

**Requirements:** Node 20+ and **Google Chrome or Edge on desktop** (mic + Web Audio + Web Speech).

```bash
npm i
cp .env.example .env.local      # then paste your key into GEMINI_API_KEY
npm run dev                     # http://localhost:3000
```

Get a key at <https://aistudio.google.com/apikey>. The key is only read on the server.

1. Open <http://localhost:3000> in Chrome and allow the microphone.
2. Leave **Inbound** + **⚡ Live** selected and press **Start call**. Use headphones for the cleanest barge-in.
3. Say: *"Meri sales is month kaafi gir gayi hain, samajh nahi aa raha kyun. Help karo."*

Other scripts: `npm test` (72 unit tests), `npm run lint`, `npm run typecheck`, `npm run build`.

### Deploy to Vercel

1. Push the repo to GitHub → **vercel.com/new** → import. No configuration needed (Next.js is auto-detected).
2. Project → **Settings → Environment Variables** → add `GEMINI_API_KEY` (Production + Preview).
3. Deploy, then open the `https://…vercel.app` URL in Chrome. HTTPS is required for the microphone, and Vercel provides it.

The browser connects **directly** to Gemini Live (WebSocket), so Vercel only serves the page plus two tiny functions (`/api/live-token`, `/api/chat`). No WebSocket proxying is needed.

---

## Architecture

```
 ┌──────────────────────────── Browser (Next.js client) ─────────────────────────────┐
 │                                                                                    │
 │  Mic ─▶ AudioWorklet (public/pcm-capture-worklet.js) ─▶ 16 kHz PCM16 (40 ms) ──┐   │
 │                                                                                │   │
 │  Speaker ◀── AudioPlayer: 24 kHz gapless queue (flush() on barge-in) ◀──────┐  │   │
 │                                                                             │  ▼   │
 │                        ┌──────────────── LiveSession ──────────────────────────┐   │
 │                        │ serverContent.audio → player   interrupted → flush()   │   │
 │                        │ input/output transcription → transcript               │   │
 │                        │ toolCall → executeTool() → sendToolResponse()          │   │
 │                        │ goAway / drop → resume with session handle            │   │
 │                        └───────────────┬────────────────────────▲──────────────┘   │
 │                                        │ UiEvents + ToolTraces  │                  │
 │       useCall() ── callReducer ──▶ Call │ Agent Brain │ Seller 360 │ Summary       │
 │            │                                                                       │
 │            └── memory (localStorage): insights, actions, follow-up, summary        │
 └──────────┬─────────────────────────────────────────┬───────────────────────────────┘
            │ ① POST /api/live-token                  │ ② WebSocket wss://… (ephemeral token)
            ▼                                         ▼
   Next.js server (holds GEMINI_API_KEY) ───▶ Gemini Live API · gemini-3.8-live (native audio)

 Fallback engine (same UI, same tools, same prompt):
   SpeechRecognition(en-IN) ─▶ POST /api/chat ─▶ runChatTurn(): Gemini text model
     ⟲ function-calling loop with executeTool() on the server ─▶ {reply, uiEvents, traces, history}
   ─▶ speechSynthesis (prefers an en-IN / hi-IN voice) ─▶ resume listening
```

### Code map

```
src/
  data/seller.ts              Given metrics (exact) + clearly-labelled assumptions, SKUs, long tail
  lib/diagnose.ts             Deterministic diagnosis & impact engine + estimateRecovery()  ← unit-tested
  lib/prompts.ts              Priya persona, voice rules, flow, guardrails, mode openings
  lib/tools/declarations.ts   9 function declarations (shared by both engines)
  lib/tools/executor.ts       executeTool(): pure, returns {response, events, resultLine}
  lib/tools/context.ts        Applies UI events to the call context (shared server/client)
  lib/tools/summary.ts        Summary + Hinglish WhatsApp text + wa.me link
  lib/live/                   Gemini Live: session, mic capture, gapless player, PCM utils, token types
  lib/fallback/               Web Speech STT, TTS, fallback session, server chat loop, API types
  lib/voice/                  Engine-agnostic VoiceSession contract, level meter
  lib/call-state.ts           Pure reducer: transcript assembly, traces, panels
  lib/memory.ts               localStorage call history + sample memory for demos
  hooks/useCall.ts            Call controller (engine choice, context ref, persistence)
  components/                 Header, CallPanel, Visualizer, AgentBrain, Seller360, SummaryModal, Drawers…
  app/api/live-token          Mints single-use ephemeral tokens
  app/api/chat                Fallback brain (function-calling loop)
  app/api/health              Tells the UI whether the key is configured (never returns it)
public/pcm-capture-worklet.js AudioWorklet: 48k float → 16k PCM16
```

---

## Voice pipeline (Live mode)

1. **Auth.** `POST /api/live-token` calls `ai.authTokens.create({ uses: 1, expireTime: +30 min, newSessionExpireTime: +2 min })`. The browser receives only `auth_tokens/…`, never the API key. The route rejects cross-origin requests. Docs and SDK disagree on `v1alpha` vs `v1beta` for tokens, so the route and the client each retry once with the other version.
2. **Capture.** `getUserMedia` with echo cancellation, noise suppression and AGC (essential for barge-in on laptop speakers) → an **AudioWorklet** on the audio thread box-filters and decimates to **16 kHz mono PCM16** in 40 ms chunks → `session.sendRealtimeInput({ audio: { mimeType: "audio/pcm;rate=16000" } })`. Mic audio streams continuously; Gemini's server-side VAD decides turns.
3. **Playback.** 24 kHz PCM chunks are scheduled back-to-back on an `AudioContext({ sampleRate: 24000 })` using a running `nextStartTime`, so there are no gaps or overlaps despite network jitter.
4. **Barge-in.** When the seller talks over Priya, the server sends `serverContent.interrupted`. We immediately `stop()` every scheduled source and reset the clock, and the transcript marks her bubble "— interrupted".
5. **Transcription.** `inputAudioTranscription` + `outputAudioTranscription` are enabled. Input transcription gets language hints (`languageCodes: ["hi-IN", "en-IN"]`) and a small `customVocabulary`, because without them short Hinglish phrases were sometimes transcribed as Spanish. These fields are in the SDK but not documented for every Live model, so if setup is rejected the session reconnects without them automatically. Seller text is always shown as-is, in any script, and wraps safely. Interim seller text (`interimInputTranscription`) shows in grey. **Bubble rules:** each Priya turn is its own bubble (`turnComplete` and tool-call boundaries start a new one), chunks are joined with a space after punctuation, and the opening greeting always stays on top. A seller transcript that lags behind Priya's reply by under 2.5 s is placed before that reply.
6. **Tools.** `toolCall.functionCalls` → `executeTool()` (shared) → `sendToolResponse({ functionResponses: [{ id, name, response }] })`. `gemini-3.8-live` runs tools **asynchronously by default**; we declare ours `behavior: BLOCKING` so Priya waits for the diagnosis before talking about it.
7. **Resilience.** `sessionResumption` handles are stored; on `goAway` or an unexpected close we reconnect with the handle (same token, then a fresh one), up to 3 times, showing "Reconnecting". `contextWindowCompression: { slidingWindow: {} }` lifts the 15-minute audio limit. Fatal failures show a friendly banner with **Switch to Fallback**.
8. **Call end.** After `end_call_summary`, Priya gives a short recap; when her goodbye finishes playing, the call hangs up and the summary opens (20 s safety timeout).

**Fallback** uses Web Speech `SpeechRecognition` (`en-IN`, continuous, interim results, auto-restart on Chrome's silence timeout, paused while Priya speaks), a 900 ms end-of-utterance debounce, `/api/chat` (Gemini text model, same tools, server-side loop that keeps thought signatures intact), and `speechSynthesis` spoken sentence-by-sentence (works around Chrome's ~15 s cut-off) with a preferred Indian voice. Barge-in is manual (Space / Interrupt button).

---

## Agent tools

| Tool | What it does | UI event |
|---|---|---|
| `get_seller_metrics()` | Profile + last vs this month; in follow-up mode also *progress since last call* | metrics card flash / progress card |
| `run_diagnosis()` | Headline, causes ruled out, issues by ₹ impact, recovery estimates per action | Issues Detected |
| `get_product_breakdown(filter \| product, competitor_price_inr?)` | SKU-level units, stock status, days OOS, lost ₹. With `product` (+ the competitor's price the seller quoted): our price vs theirs, the gap, and whether ours is **out of stock** (then the real problem is no stock, not price), with grounded advice | timeline |
| `record_seller_insight(topic, detail, seller_words)` | Saves **every** fact or opinion *the seller* states (supplier dates, priorities, competitor prices, what they already did). Guard: needs the seller's own words, rejects Priya's own notes/to-dos ("…needs confirmation by seller") and placeholders ("details pending"); a new insight on the same topic with overlapping content **updates** the earlier one | Seller Insights |
| `propose_action(title, why, expected_recovery_inr, owner, due_date, action_type?)` | Adds or **updates** an action: the same action type (inferred from the title if missing) replaces the earlier one, so there are no near-duplicates. **₹ always comes from the engine**: typed actions get the official estimate, untyped ones get ₹0 (no invented figures). Guard: needs `run_diagnosis` + ≥2 seller insights first (≥1 in follow-up) | Action Plan + Recovery bar |
| `execute_mock_action(type, seller_consent_quote, products?, details?)` | *Prepares* a restock list with quantities, a pause of **only the listings the seller named** (fuzzy-matched in `src/lib/products.ts`; nothing is paused if nothing matches), stock-alert rules, deal enrolment, or auto-reactivation on restock; marks the action *executed*. Guards: the action must be proposed first, not already executed, and the quote must be an explicit yes | Action Plan (executed + details) |
| `schedule_follow_up(when, purpose)` | Books **the** follow-up (a second call replaces it). `when` is the seller's words ("next Monday", "in a week", "20 November", "bees tareekh"), resolved in code against today's date in Asia/Kolkata (`src/lib/dates.ts`); returns `say_exactly` ("Monday, 16 November") for Priya to speak | Follow-up card |
| `escalate_to_human_kam(reason)` | Ticket + SLA for angry sellers, payments, policy, out-of-scope | Escalation banner |
| `end_call_summary(issues, actions, next_steps, seller_declined_more_help, follow_up_declined?)` | Builds the on-screen summary: ≥2 issues (topped up from the diagnosis) and **every** proposed action with its status, plus Hinglish WhatsApp text and a `wa.me/?text=` share link. Nothing is sent automatically. Guards: ≥2 actions, a follow-up (or explicit refusal), and the seller actually *answered* "kuch aur help?" (checked from the transcript) | Summary modal |

---

## Diagnosis logic (`src/lib/diagnose.ts`)

All pure functions, covered by `src/lib/diagnose.test.ts`.

- **Headline: volume, not price.** Orders −32.5% and sales −32.5% while ASP is flat at ₹500, so **pricing is ruled out**. Saying so is part of a good diagnosis.
- **Inventory (data, critical).** OOS 5 → 18 (30% of 60 listings). Lost revenue = Σ over *newly* out-of-stock SKUs of (units last month − units this month) × price = **₹47,117**. The three biggest are the pressure cooker, the Jaipuri bedsheets and the tawa.
- **Visibility (inference, high).** In-stock SKUs and the long tail also fell (**₹15,240**) with no price change. Fewer in-stock listings and more cancellations typically lower search ranking.
- **Promotions (inference, medium).** No deals or ads this month; a deal typically adds ~10%, so **₹13,500** (assumption-based, low confidence).
- **Cancellations (data, high).** 8% → 14%, so (0.14 − 0.08) × 270 ≈ **16 extra cancelled orders × ₹500 = ₹8,000**. 26 of 38 are "item unavailable / seller cancelled", correlated with stock-outs. Severity is bumped because 14% is above the assumed 10% rating-risk threshold.
- Reconciliation: inventory ₹47,117 + visibility ₹15,240 + old stock-outs ₹2,643 = **₹65,000**, exactly the drop. Impacts overlap and are labelled *not additive*.

`estimateRecovery(actionType)` (rounded to ₹500, conservative):

| Action | Estimate | Basis |
|---|---|---|
| `generate_restock_list` | ₹35,500/mo | ~75% of inventory loss returns within a month |
| `pause_unrestockable_listings` | ₹6,000/mo | avoids ~75% of extra "unavailable" cancellations + protects rating |
| `targeted_sku_deal` | ₹2,000/mo | coupon on ONE competitor-pressured product (once in stock): ~15% of a typical top seller's monthly sales; never a catalogue-wide price cut |
| `enable_stock_alerts` | ₹4,500/mo | prevents ~10% of repeat stock-out loss |
| `enroll_in_deal` | ₹13,500/mo | ~10% uplift, only once stock is back |
| `reactivate_listings_on_restock` | ₹7,500/mo | ~50% of the visibility loss; the alternative to pausing when the seller has already paused listings |

All four together project ₹1.35L → ₹1.945L, below last month's ₹2L (tested).

---

## Guardrails in code (`src/lib/tools/guards.ts`)

Prompts say what Priya should do; the guards make the important rules hold even when the model slips. A blocked call returns `{ ok: false, blocked: true, reason }`. The model reads the reason and corrects itself, and the Agent Brain shows an amber **guardrail** entry.

| Rule | Enforced in |
|---|---|
| Diagnose before recommending; ask ≥2 follow-up questions (≥1 in follow-up mode) before proposing actions | `propose_action` |
| No invented ₹: typed actions get the engine estimate, untyped ones ₹0 | `propose_action` |
| Execute only proposed, not-yet-executed actions, and only on an explicit yes (`classifyConsent` handles Hinglish, English and Devanagari; "nahi, bas theek hai" → no, a plain "theek hai" → ambiguous, "jo restock nahi ho sakti unki listing pause kar do" → yes) | `execute_mock_action` |
| Don't end until ≥3 actions exist (2 in follow-up mode), a follow-up is booked (or refused), and the seller has **answered** "kuch aur help chahiye?" with a no or goodbye. `src/lib/tools/signals.ts` tracks from the transcript when Priya asked and when the seller last spoke, so asking and ending in the same turn is blocked (escalated calls are exempt) | `end_call_summary` |
| Hang up only after the goodbye audio has finished playing (20 s safety timeout); if the seller speaks again after the summary, the call stays open | `LiveSession` / `FallbackSession` |
| **Never answer her own question.** While Priya's last question (a "?" in her transcript) is unanswered, `schedule_follow_up`, `execute_mock_action` (unless the seller's last words were a yes) and `end_call_summary` are refused with `await_seller`, and the Live engine **mutes whatever she generates next until the seller speaks**. `schedule_follow_up` also needs the seller's latest words to name a day or agree ("haan", "chalega", "Tuesday") | executor + `LiveSession` |
| Bookkeeping tools (`record_seller_insight`, `propose_action`) run `NON_BLOCKING` and their responses are sent with `scheduling: SILENT`, so a tool result doesn't make Priya start a new turn. Data/action tools stay `BLOCKING` | `declarations.ts` + `LiveSession` |
| ≥3 distinct actions before ending (2 in a follow-up call) | `end_call_summary` |
| System cues like `[CALL_CONNECTED]` are stripped from Priya's bubbles (even when split across chunks) | `call-state.ts` |
| Don't push: an offer that didn't get a yes is remembered (`declined_offers`) and the model is told not to repeat it unless the seller brings it up | `execute_mock_action` |
| Insights only from the seller; pause only the products the seller named; one follow-up per call; dates resolved in code; no duplicate actions | `record_seller_insight`, `execute_mock_action`, `schedule_follow_up`, `propose_action` |
| Never claim anything was sent: tool responses carry `how_to_say` ("ready kar diya hai") and summaries are "on screen" | executor responses + prompt |

The consent quote is supplied by the model, so this is a strong nudge rather than proof; the prompt rule and the code check reinforce each other.

## Prompt design (`src/lib/prompts.ts`)

The prompt is split into named, ordered sections so behaviour is easy to audit and tune:

1. **Who you are.** A warm, confident, sharp KAM whose job is to *own* the outcome, not answer questions.
2. **How you speak.** Written for the ear: 1–3 short sentences, one question per turn, no lists or symbols, Indian number words ("ek lakh paintees hazaar"), acknowledge before moving on, adapt when interrupted.
3. **Language.** Mirror Hindi / Hinglish / English and switch when the seller does; tool text in English.
4. **Seller & today.** Name, store, category, city; today's date and weekday in India plus a 14-day calendar, and the rule to never compute dates but speak what `schedule_follow_up` returns.
5. **Call flow.** Greet → understand → **run_diagnosis before explaining** → lead with the single biggest issue + "pricing is not the problem" → ask 2–3 follow-up questions (one per turn) → record every insight → 2–3 tailored actions with ₹ → *offer* to execute → confirm follow-up → spoken recap + "kuch aur help chahiye?" → summary → one-line goodbye.
6. **Adapt.** Every seller statement can change the plan: record it, don't re-recommend what they already did. Worked example: the seller already paused listings and now in-stock products aren't selling, so explain the visibility effect and switch to reactivate-on-restock, restock first, a deal on in-stock items, and alerts.
7. **Listen first.** Answer the seller's actual question first; make each offer at most once; if the seller is irritated, apologise briefly and let them lead; handle several requests at once and confirm them in one sentence. One turn, then wait: never speak twice in a row.
8. **Unknowns.** For things the data doesn't cover (e.g. competitor prices): say so honestly, ask which product and at what price, record it, look the product up (`get_product_breakdown` with the competitor price), say both prices out loud, flag if ours is out of stock (buyers leave because we have nothing to sell), then advise: restock first, a targeted coupon on that product only if the gap matters, never a catalogue-wide price cut (ASP is flat).
9. **Consent.** Act only on an explicit yes ("haan", "kar do"). "Nahi", "bas theek hai" or a plain "theek hai" is not consent. Act only on the products the seller named.
10. **Grammar.** Priya is a woman: "karti hoon", "chahti hoon", "rahi hoon", never "karta/chahta". Ramesh ji is a man: "aap kar sakte hain", "batayiye", "aap chahenge", never "sakti hain".
11. **Guardrails.** Never invent numbers (only tool outputs), estimates are estimates, **be honest about what was done** ("maine aapke liye ready kar diya hai", never "maine bhej diya"; the summary is on screen to share on WhatsApp), escalate for anger/payments/policy, stay on topic, never expose tools/IDs.
12. **System cues.** `[CALL_CONNECTED]` lets Priya speak first without the seller saying anything, and is never read aloud.
13. **Mode opening.** Inbound greets and asks; Proactive runs the diagnosis then leads with the finding; Follow-up loads progress and opens on the seller's own commitment from memory.

Why this works for voice: the biggest failure modes of voice agents are monologues, lists read aloud, robotic numbers, and confident hallucinated figures. Each has an explicit rule, and the last is also enforced in code (`propose_action` overrides model-supplied ₹ with the engine's value).

---

## Assumptions

Shown in the app's **Data & assumptions** drawer; defined in `src/data/seller.ts`.

- Seller **Ramesh Kumar**, "Ramesh Home Essentials", Home & Kitchen, Jaipur, 3 years on the platform, **60 active listings**.
- Top 20 SKUs listed individually (₹299–₹799); the other 40 aggregated as a long tail. **SKU + long-tail totals reconcile exactly** with 400 → 270 orders and ₹2,00,000 → ₹1,35,000 (tested). One order = one unit.
- 13 SKUs went out of stock this month (10 in the top 20, several of them last month's best sellers); 5 were already out of stock.
- Most cancellations this month (26 of 38) are "item unavailable / seller cancelled".
- No price changes; no deals or ads this month; competitor deal activity is an assumption (so that finding is low-confidence).
- Follow-up "progress since last call" is **simulated** from which actions were executed last time (clearly labelled).
- A cancellation rate above 10% is assumed to hurt rating/ranking; a deal is assumed to lift sales ~10%.

### Other decisions made autonomously

- **Models.** `gemini-3.8-live` (current stable native-audio Live model; supports sync + async function calling and transcription) and `gemini-3.6-flash` (stable Flash) for fallback. Both overridable via env.
- **Voice.** Prebuilt voice `Kore`. Language is left to auto-detect so Priya can code-switch between Hindi and English.
- **Token scope.** Tokens are single-use with short expiry but don't lock the config, so the client can pass the mode-specific prompt and resumption handle. Production hardening: build the config server-side and lock it with `liveConnectConstraints`.
- **Sample memory.** Follow-up mode works on a fresh browser via a built-in, clearly-labelled sample "last call".
- **No Snapdeal branding.** Accent colour only; no logos or trademarks.

---

## Latency

- **Live mode.** Speech-to-speech in one model: no separate STT → LLM → TTS hops. Time to first audio is typically well under a second after the seller stops talking (network-dependent; not formally benchmarked here). Tools run locally in the browser in < 5 ms; a blocking tool call adds roughly one extra model round-trip (~0.3–1 s) before Priya speaks, so the prompt lets her say a short "ek second, data dekh rahi hoon" first.
- **Fallback.** 900 ms end-of-utterance wait + text model (~1–3 s including tool rounds, `thinkingLevel: LOW`) + TTS start (~100–300 ms) ≈ **2–4 s** per turn. Fine as a safety net, which is why Live is primary.

## Cost per call (rough estimate)

Method: a typical 4-minute call with ~12 turns. Prices are paid tier, from the Gemini pricing page as of Nov 2026, at ₹88/USD.

**Live (`gemini-3.8-live`).** Audio in $3/M tokens (≈ $0.005/min), audio out $12/M (≈ $0.018/min), text in $0.75/M.
- Mic audio streamed: 4 min × $0.005 = **$0.020**
- Priya's speech: ~2 min × $0.018 = **$0.036**
- Context re-processed each turn (system prompt ~2.5k tokens + tool results ~3k + growing conversation): ~12 turns × ~8k tokens ≈ 100k tokens. At the text rate ≈ $0.075; if mostly billed as audio, up to ≈ $0.30.
- **≈ $0.13–0.36 per call (≈ ₹11–32).**

**Fallback (`gemini-3.6-flash`, $0.75 in / $3.75 out per M through Dec 2026).** ~15 model calls (turns + tool rounds) × ~6k input tokens ≈ 90k → $0.068; ~3k output → $0.011; STT/TTS are free (browser). **≈ $0.08 per call (≈ ₹7).**

Levers: shorter system prompt, compact tool payloads (already trimmed), context caching for the text path, and ending sessions promptly.

---

## Limitations

- Seller data is mock and static; "progress since last call" is simulated.
- Mock actions don't touch real systems (they return realistic confirmations).
- Memory lives in `localStorage` (per browser, not per seller account).
- Fallback STT/TTS quality depends on the browser and OS voices; best in Chrome. Barge-in in fallback is manual.
- Speech recognition of mixed Hindi/English is good but not perfect; numbers spoken by the seller can be mis-heard.
- No authentication or rate limiting beyond a same-origin check on the token route.
- Not formally evaluated: there is no automated conversation-quality eval suite yet.

## Future scope

- **Telephony and WhatsApp.** Connect Gemini Live to phone calls via **Exotel** or **Twilio** Media Streams (8 kHz μ-law ↔ PCM16 bridge), and WhatsApp Business API for summaries and voice notes.
- **Real seller APIs.** Orders, inventory, cancellations, ranking and ads data; real actions (listing pause, deal enrolment, supplier POs) behind confirmation.
- **More Indian languages.** Tamil, Telugu, Marathi, Bengali, Kannada via language detection and per-language voices and prompts.
- **Evals.** Scripted seller personas (angry, confused, Hindi-only, off-topic), automated checks for grounding ("every ₹ spoken appears in a tool result"), turn length, one-question-per-turn, and escalation correctness; latency and cost dashboards.
- **CRM memory.** Per-seller history, KAM handoff notes, proactive outreach triggered by anomaly detection on daily metrics.
