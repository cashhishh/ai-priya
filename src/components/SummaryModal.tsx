"use client";
import { useEffect, useState } from "react";
import type { ActionItem, CallSummary, FollowUp } from "@/lib/types";
import { formatInrShort } from "@/lib/format";
import { prettyDate } from "@/lib/tools/summary";
import { Badge, CheckIcon, CopyIcon, ShareIcon, XIcon } from "./ui";

export function SummaryModal({
  summary,
  actions,
  followUp,
  onClose,
}: {
  summary: CallSummary;
  actions: ActionItem[];
  followUp: FollowUp | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const recovery = actions.reduce((s, a) => s + a.expected_recovery_inr, 0);
  const executed = actions.filter((a) => a.status === "executed").length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary.whatsapp_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked: the text is visible anyway */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose} role="dialog" aria-modal aria-label="Call summary">
      <div className="max-h-[92vh] w-full max-w-3xl animate-pop-in overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-accent-50 to-white px-6 py-5">
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">Call summary</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-900">What we found, what we&apos;re doing, what&apos;s next</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recovery > 0 && <Badge tone="green">~{formatInrShort(recovery)}/month estimated recovery</Badge>}
              <Badge>{actions.length} actions · {executed} executed</Badge>
              {followUp && <Badge tone="accent">Follow-up {prettyDate(followUp.date)}</Badge>}
              {summary.auto_generated && <Badge tone="amber">auto-generated (call ended early)</Badge>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <XIcon size={18} />
          </button>
        </div>

        <div className="scroll-thin grid max-h-[60vh] gap-5 overflow-y-auto p-6 md:grid-cols-2">
          <div className="space-y-5">
            <Section title="Issues" items={summary.issues} tone="red" />
            {actions.length ? <ActionsSection actions={actions} /> : <Section title="Actions" items={summary.actions} tone="green" />}
            <Section title="Next steps" items={summary.next_steps} tone="slate" />
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">WhatsApp message (Hinglish)</p>
            <pre className="rounded-2xl bg-[#e7fbe6] p-4 font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-800 ring-1 ring-emerald-200">{summary.whatsapp_text}</pre>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={copy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />} {copied ? "Copied" : "Copy summary"}
          </button>
          <a
            href={summary.whatsapp_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-95"
          >
            <ShareIcon size={15} /> Share on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

/** Every proposed action with its status, so nothing agreed on the call is dropped. */
function ActionsSection({ actions }: { actions: ActionItem[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Actions</p>
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className="text-sm leading-relaxed text-slate-700">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-slate-800">{a.title}</span>
              {a.status === "executed" ? <Badge tone="green">executed ✓</Badge> : <Badge tone="amber">proposed · due {prettyDate(a.due_date)}</Badge>}
            </div>
            <p className="text-xs text-slate-500">
              {a.owner === "kam" ? "Owner: Priya" : "Owner: seller"}
              {a.expected_recovery_inr ? ` · ~${formatInrShort(a.expected_recovery_inr)}/month (est.)` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: "red" | "green" | "slate" }) {
  const dot = tone === "red" ? "bg-red-500" : tone === "green" ? "bg-emerald-500" : "bg-slate-400";
  return (
    <div>
      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}
