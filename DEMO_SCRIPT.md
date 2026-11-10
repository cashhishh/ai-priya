# Demo script: 1:45 main call + 0:15 follow-up clip

**Setup (before recording)**
- Chrome, `npm run dev` (or the Vercel URL), window ~1500 px wide so all three columns show.
- **Wear headphones** so Priya doesn't hear herself and barge-in is crisp.
- Open the ⓘ drawer → **Reset memory** (so the follow-up clip uses *this* call's memory).
- Mode **Inbound**, engine **⚡ Live**. Do one warm-up call off-camera to confirm the mic works.
- Priya is a live model, so her exact words will vary. Keep your lines and adapt your timing. If she asks something else, answer naturally with the same facts.

---

## Part 1: Inbound call (1:45)

| Time | You do / say | What viewers see |
|---|---|---|
| **0:00–0:07** | *(voice-over)* "This is Priya, a voice-first AI account manager for sellers. I'm the seller; let's call her." Click **Start call**. | Status: Connecting → Listening; visualiser comes alive. |
| **0:07–0:12** | — | Priya greets in Hinglish and asks how she can help. |
| **0:12–0:20** | **"Hi Priya. Meri sales is month kaafi gir gayi hain. Samajh nahi aa raha kyun. Help kar sakti ho?"** | Seller bubble; status → Thinking. |
| **0:20–0:35** | — *(let her talk)* | Agent brain: **🩺 run_diagnosis → 4 issues, biggest: stock-outs ≈ ₹47.1k/month; pricing ruled out**. Issues Detected fills in. Priya: orders down about a third, pricing is fine, the main reason is top sellers going out of stock. She asks *why* they went out of stock. |
| **0:35–0:45** | **Barge-in moment:** as soon as she starts her next sentence (e.g. about cancellations), **cut in**: **"Haan haan, woh mere Delhi wale supplier ka delay hai. Bees tareekh tak maal aa jayega."** | Her bubble shows **"— interrupted"**, audio stops instantly. 📝 *record_seller_insight* → Seller Insights: "supplier delayed, restock by the 20th". |
| **0:45–0:55** | She asks which products can't be restocked soon. **"Brass diya aur jute basket abhi nahi aayenge. Aur copper bottle ka supplier band ho gaya hai."** | Another insight recorded. |
| **0:55–1:10** | — | Priya recommends **2–3 actions with ₹**: restock top sellers first (~₹35k), pause listings you can't restock so cancellations stop and your rating is protected (~₹6k), and a deal once stock is back (~₹13k). 🎯 *propose_action ×3* → Action Plan + **Revenue recovery bar** grows ₹1.35L → ~₹1.9L. She *asks* whether to prepare them now. |
| **1:10–1:18** | **"Haan, restock list abhi bana do, aur jo restock nahi ho sakti unki listing pause kar do."** | ⚡ *execute_mock_action ×2* → actions flip to **executed** (expand to show the restock list; the pause covers only the brass diya, jute basket and copper bottle you named). Priya says she has *prepared* them ("ready kar diya hai"). |
| **1:18–1:25** | She suggests a follow-up date. **"Haan, agle Monday theek hai."** | 📅 *schedule_follow_up* → Follow-up card with the real date (resolved in code). She says the exact weekday + date it returns. |
| **1:25–1:35** | — | Priya recaps 1–2 issues + the actions, confirms Monday, asks **"Kuch aur help chahiye?"** and *waits*. (If she tries to end in the same breath, the Agent Brain shows a guardrail and she waits.) |
| **1:35–1:40** | **"Nahi, bas itna hi. Thank you Priya!"** | 🧾 *end_call_summary*; one-line goodbye ("summary aapki screen par ready hai, WhatsApp par share kar sakte hain"); the call ends automatically once her goodbye has finished playing. |
| **1:40–1:45** | Hover **Share on WhatsApp** in the Summary modal. *(voice-over)* "Every action with its status, ready to share in Hinglish." | Summary modal: issues, all actions (executed ✓ / proposed), Hinglish WhatsApp message. |

**Guardrails you may see (good to point out):** if Priya tries to recommend before asking enough questions, end the call before 2 actions, or act without a clear "haan", the Agent Brain shows an amber **guardrail** entry and she corrects course on her own. Optional bonus moment: when she offers the deal, say **"Nahi, abhi nahi"**. She won't execute it, and it stays *proposed*.

**Optional competitor moment (+15 s):** say **"Ek aur baat, competitor pressure cooker saat sau mein bech raha hai."** She says she has no competitor price data, looks the product up, compares ₹799 vs ₹700 out loud, points out *our cooker is out of stock* (that's why buyers go to the competitor), and suggests restocking first, then a coupon on the cooker only, not a price cut across the store.

**If something goes off-script**
- She hasn't proposed actions by 1:00: say **"Toh ab mujhe kya karna chahiye?"**
- She doesn't offer to execute: say **"Kya aap restock list abhi bana sakti ho?"**
- She doesn't wrap up: say **"Theek hai, ab summary bana do. Aur kuch nahi chahiye."**
- Live won't connect: click **Switch to Fallback** in the red banner (it redials). In Fallback, press **Space** to interrupt.

---

## Part 2: Follow-up mode with memory (0:15)

| Time | You do / say | What viewers see |
|---|---|---|
| **0:00–0:03** | Close the modal, select **Follow-up**, click **Start call**. *(voice-over)* "A week later, Priya calls back." | Header note: "Using memory from the call on …". |
| **0:03–0:09** | — | 📊 *get_seller_metrics* → **Since last call** card (out of stock 18 → 7, cancellations 14% → 6%). Priya: *"Last time you said the supplier would restock by the twentieth. Did the stock arrive?"* |
| **0:09–0:15** | **"Haan, zyada tar maal aa gaya hai."** Then stop recording. | Priya celebrates the drop in cancellations and moves to the next step (the deal). |

*(Optional variant: use **Proactive** mode instead, where Priya calls first and leads with "your orders dropped about a third, mainly because top sellers went out of stock".)*
