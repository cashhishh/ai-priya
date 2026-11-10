"use client";
import { useEffect, useRef } from "react";
import type { ToolTrace } from "@/lib/types";
import { Badge, BrainIcon, Card, cx } from "./ui";

const LABELS: Record<string, { label: string; emoji: string }> = {
  get_seller_metrics: { label: "Pulled seller metrics", emoji: "📊" },
  run_diagnosis: { label: "Ran diagnosis engine", emoji: "🩺" },
  get_product_breakdown: { label: "Checked product breakdown", emoji: "📦" },
  record_seller_insight: { label: "Recorded seller insight", emoji: "📝" },
  propose_action: { label: "Proposed action", emoji: "🎯" },
  execute_mock_action: { label: "Executed action", emoji: "⚡" },
  schedule_follow_up: { label: "Scheduled follow-up", emoji: "📅" },
  escalate_to_human_kam: { label: "Escalated to human KAM", emoji: "🙋" },
  end_call_summary: { label: "Built call summary", emoji: "🧾" },
};

export function AgentBrain({ traces, active }: { traces: ToolTrace[]; active: boolean }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [traces.length]);

  return (
    <Card
      title="Agent brain"
      icon={<BrainIcon size={15} />}
      className="flex h-full min-h-[420px] flex-col lg:min-h-[520px]"
      right={<span className="text-[11px] text-slate-400">{traces.length} tool call{traces.length === 1 ? "" : "s"}</span>}
    >
      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4">
        {traces.length === 0 ? (
          <div className="mx-auto mt-8 max-w-xs text-center">
            <p className="text-sm font-medium text-slate-600">{active ? "Listening for the seller's concern…" : "Priya's reasoning shows up here"}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Every tool call (diagnosis, insights, actions, follow-ups) appears live with its result. All ₹ figures come from deterministic code, not the LLM.
            </p>
          </div>
        ) : (
          <ol className="relative space-y-3 border-l border-slate-200 pl-5">
            {traces.map((t) => (
              <TraceItem key={t.id} trace={t} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>
    </Card>
  );
}

function TraceItem({ trace }: { trace: ToolTrace }) {
  const meta = LABELS[trace.name] ?? { label: trace.name, emoji: "🔧" };
  const argChip =
    typeof trace.args.filter === "string"
      ? trace.args.filter
      : typeof trace.args.type === "string"
        ? trace.args.type
        : typeof trace.args.topic === "string"
          ? trace.args.topic
          : null;
  return (
    <li className="relative animate-fade-up">
      <span
        className={cx(
          "absolute top-1 -left-[27px] grid h-3.5 w-3.5 place-items-center rounded-full ring-4 ring-white",
          trace.status === "running" && "bg-violet-500 animate-pulse-dot",
          trace.status === "done" && "bg-emerald-500",
          trace.status === "error" && "bg-red-500",
          trace.status === "blocked" && "bg-amber-500",
          trace.status === "cancelled" && "bg-slate-300",
        )}
      />
      <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] font-semibold text-slate-800">
            <span className="mr-1.5">{meta.emoji}</span>
            {meta.label}
          </p>
          <div className="flex items-center gap-1.5">
            {argChip && <Badge>{argChip.replace(/_/g, " ")}</Badge>}
            {trace.status === "running" ? (
              <Badge tone="violet">running</Badge>
            ) : trace.status === "cancelled" ? (
              <Badge>cancelled</Badge>
            ) : trace.status === "error" ? (
              <Badge tone="red">error</Badge>
            ) : trace.status === "blocked" ? (
              <Badge tone="amber">guardrail</Badge>
            ) : (
              <span className="font-mono text-[10px] text-slate-400">{trace.duration_ms ?? 0}ms</span>
            )}
          </div>
        </div>
        <p className="mt-0.5 font-mono text-[11px] text-slate-400">{trace.name}()</p>
        {trace.status === "running" ? (
          <div className="shimmer mt-2 h-3 w-3/4 rounded" />
        ) : (
          trace.result_line && (
            <p className={cx("mt-1.5 text-xs leading-relaxed", trace.status === "blocked" ? "text-amber-700" : "text-slate-600")}>→ {trace.result_line}</p>
          )
        )}
      </div>
    </li>
  );
}
