"use client";
import { useEffect, type ReactNode } from "react";
import { ASSUMPTIONS, METRICS, SKUS } from "@/data/seller";
import { formatInr, formatPct } from "@/lib/format";
import type { CallRecord } from "@/lib/types";
import { prettyDate } from "@/lib/tools/summary";
import { Badge, TrashIcon, XIcon } from "./ui";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal aria-label={title}>
      <aside className="h-full w-full max-w-xl animate-slide-in-right overflow-y-auto bg-white shadow-2xl scroll-thin" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </aside>
    </div>
  );
}

export function AssumptionsContent({ lastCall, onResetMemory }: { lastCall: CallRecord | null; onResetMemory: () => void }) {
  const l = METRICS.last_month;
  const c = METRICS.this_month;
  return (
    <div className="space-y-6 text-sm">
      <section>
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
          Given data <Badge tone="blue">from the brief</Badge>
        </h3>
        <table className="w-full overflow-hidden rounded-xl text-xs ring-1 ring-slate-200">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Metric</th>
              <th className="px-3 py-2 text-right font-medium">Last month</th>
              <th className="px-3 py-2 text-right font-medium">This month</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            <Row k="Sales" a={formatInr(l.sales_inr)} b={formatInr(c.sales_inr)} />
            <Row k="Orders" a={String(l.orders)} b={String(c.orders)} />
            <Row k="Cancellation rate" a={formatPct(l.cancellation_rate)} b={formatPct(c.cancellation_rate)} />
            <Row k="Avg selling price" a={formatInr(l.avg_selling_price_inr)} b={formatInr(c.avg_selling_price_inr)} />
            <Row k="Out-of-stock products" a={String(l.out_of_stock_products)} b={String(c.out_of_stock_products)} />
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-slate-800">
          Assumptions <Badge tone="amber">added by us</Badge>
        </h3>
        <dl className="space-y-2">
          {ASSUMPTIONS.map((a) => (
            <div key={a.label} className="rounded-xl bg-slate-50 px-3 py-2">
              <dt className="text-xs font-semibold text-slate-700">{a.label}</dt>
              <dd className="text-xs leading-relaxed text-slate-600">{a.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 font-semibold text-slate-800">Top 20 SKUs (assumed)</h3>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Product</th>
                <th className="px-2 py-1.5 text-right font-medium">Price</th>
                <th className="px-2 py-1.5 text-right font-medium">Units LM → TM</th>
                <th className="px-2 py-1.5 text-left font-medium">Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {SKUS.map((s) => (
                <tr key={s.sku}>
                  <td className="px-2 py-1.5">{s.name}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">₹{s.price_inr}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {s.units_last_month} → {s.units_this_month}
                  </td>
                  <td className="px-2 py-1.5">
                    {s.stock_status === "out_of_stock" ? (
                      <Badge tone={s.newly_out_of_stock ? "red" : "slate"}>{s.newly_out_of_stock ? `OOS ${s.days_out_of_stock}d (new)` : `OOS ${s.days_out_of_stock}d`}</Badge>
                    ) : s.stock_status === "low_stock" ? (
                      <Badge tone="amber">low ({s.units_in_stock})</Badge>
                    ) : (
                      <Badge tone="green">in stock</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="font-semibold text-slate-800">Call memory</h3>
        <p className="mt-1 text-xs text-slate-600">
          {lastCall
            ? `Last call saved on ${prettyDate(lastCall.date)}: ${lastCall.insights.length} insights, ${lastCall.actions.length} actions${lastCall.follow_up ? `, follow-up ${prettyDate(lastCall.follow_up.date)}` : ""}. Stored only in this browser (localStorage).`
            : "No calls saved yet. Follow-up mode will use a clearly-labelled sample memory."}
        </p>
        <button
          onClick={onResetMemory}
          disabled={!lastCall}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
        >
          <TrashIcon size={13} /> Reset memory
        </button>
      </section>
    </div>
  );
}

function Row({ k, a, b }: { k: string; a: string; b: string }) {
  return (
    <tr>
      <td className="px-3 py-2">{k}</td>
      <td className="px-3 py-2 text-right tabular-nums">{a}</td>
      <td className="px-3 py-2 text-right font-semibold tabular-nums">{b}</td>
    </tr>
  );
}

const DIAGRAM = `
 ┌──────────────────────── Browser (Next.js page) ───────────────────────┐
 │  Mic ─▶ AudioWorklet ─▶ 16 kHz PCM16 ──┐        ┌─▶ Agent Brain panel │
 │                                        │        ├─▶ Seller 360 panels │
 │  Speaker ◀─ 24 kHz gapless player ◀─┐  │        └─▶ Summary + memory  │
 │                                     │  ▼              ▲               │
 │                         ┌───────── LiveSession ───────┴──┐            │
 │                         │ toolCall ─▶ executeTool() ─────┤ UI events  │
 │                         │ (shared tools + diagnosis)     │            │
 │                         └──────────────┬─────────────────┘            │
 └─────────────────────────────────────── │ ──────────────────────────────┘
          ① POST /api/live-token          │ ② WebSocket (ephemeral token)
                    │                     ▼
          Next.js server ──────▶  Gemini Live (native audio)
          (holds API key)

 Fallback:  SpeechRecognition (en-IN) ─▶ POST /api/chat ─▶ Gemini text model
            + same tools/prompt (server loop) ─▶ reply ─▶ speechSynthesis (Indian voice)
`;

export function HowItWorksContent() {
  return (
    <div className="space-y-5 text-sm text-slate-700">
      <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono text-[10.5px] leading-[1.45] text-slate-100">{DIAGRAM}</pre>
      <Step n={1} title="Real-time voice (Live mode)">
        The browser streams 16 kHz mic audio straight to Gemini Live&apos;s native-audio model over a WebSocket, authenticated by a 30-minute single-use
        ephemeral token minted by our server. The API key never reaches the browser. Gemini&apos;s voice activity detection handles turn-taking; when you talk over
        Priya the server sends <code>interrupted</code> and playback is flushed instantly (barge-in).
      </Step>
      <Step n={2} title="Grounded diagnosis">
        Priya must call <code>run_diagnosis</code> before explaining anything. The diagnosis is deterministic TypeScript (unit-tested), not the LLM, so every ₹
        figure she speaks is reproducible. She may only quote tool numbers.
      </Step>
      <Step n={3} title="An agent that owns the problem">
        9 tools let Priya record what the seller says, propose prioritised actions with ₹ recovery, execute mock actions (restock list, pause listings, stock
        alerts, deal enrolment), book a follow-up, escalate to a human, and produce a WhatsApp-ready summary.
      </Step>
      <Step n={4} title="Memory and three call modes">
        Each call is saved locally. Follow-up mode loads the last call, opens by checking the seller&apos;s commitments, and compares (simulated) progress.
      </Step>
      <Step n={5} title="Never-break fallback">
        If Live is unavailable, Fallback mode uses browser speech recognition + the same prompt, tools and engine via <code>/api/chat</code>, with an Indian TTS
        voice.
      </Step>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-50 text-xs font-bold text-accent">{n}</span>
      <div>
        <p className="font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{children}</p>
      </div>
    </div>
  );
}
