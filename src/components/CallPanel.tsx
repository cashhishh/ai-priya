"use client";
import { useEffect, useRef, useState } from "react";
import { displayText, type TranscriptEntry } from "@/lib/call-state";
import { formatDuration } from "@/lib/format";
import type { CallMode, VoiceEngine } from "@/lib/types";
import type { AudioLevels, CallStatus } from "@/lib/voice/types";
import { Visualizer } from "./Visualizer";
import { Badge, Card, HeadsetIcon, cx } from "./ui";

function useElapsed(startedAt: number | null, endedAt: number | null): number {
  // Clock starts at 0 and is only read in effects (time can't be read during prerender).
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!startedAt || endedAt) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [startedAt, endedAt]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor(((endedAt ?? (now || startedAt)) - startedAt) / 1000));
}

const OPENERS: Record<CallMode, string> = {
  inbound: "Press Start call, then tell Priya: “Meri sales is month kaafi gir gayi hain, samajh nahi aa raha kyun. Help karo.”",
  proactive: "Priya will call you first and lead with what she found in your numbers.",
  follow_up: "Priya will call back, check on last call's commitments and compare progress.",
};

export function CallPanel(props: {
  status: CallStatus;
  engine: VoiceEngine;
  mode: CallMode;
  transcript: TranscriptEntry[];
  startedAt: number | null;
  endedAt: number | null;
  getLevels: () => AudioLevels;
  onInterrupt: () => void;
}) {
  const { status, transcript } = props;
  const elapsed = useElapsed(props.startedAt, props.endedAt);
  const scrollRef = useRef<HTMLDivElement>(null);
  const active = status !== "idle" && status !== "ended";

  // Auto-scroll as the conversation grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcript]);

  return (
    <Card
      title="Call"
      icon={<HeadsetIcon size={15} />}
      className="flex h-full min-h-[420px] flex-col lg:min-h-[520px]"
      right={
        <div className="flex items-center gap-2">
          <Badge tone={props.engine === "live" ? "accent" : "slate"}>{props.engine === "live" ? "Gemini Live · native audio" : "Fallback · browser speech"}</Badge>
          <span className={cx("font-mono text-xs tabular-nums", active ? "text-slate-700" : "text-slate-400")}>{formatDuration(elapsed)}</span>
        </div>
      }
    >
      <div className="border-b border-slate-100 px-4 pt-3 pb-2">
        <Visualizer getLevels={props.getLevels} status={status} />
      </div>

      <div ref={scrollRef} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {transcript.length === 0 && (
          <div className="mx-auto mt-8 max-w-xs text-center">
            <p className="text-sm font-medium text-slate-600">{active ? "Connecting to Priya…" : "No call in progress"}</p>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">{OPENERS[props.mode]}</p>
          </div>
        )}
        {transcript.map((e) => (
          <Bubble key={e.id} entry={e} />
        ))}
      </div>

      {active && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
          <span>
            {props.engine === "live" ? "Just talk. Interrupt Priya any time and she'll stop and listen." : "Speak after Priya finishes. Press Space or tap Interrupt to cut in."}
          </span>
          <button
            onClick={props.onInterrupt}
            disabled={status !== "speaking"}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
          >
            Interrupt
          </button>
        </div>
      )}
    </Card>
  );
}

function Bubble({ entry }: { entry: TranscriptEntry }) {
  const seller = entry.role === "seller";
  const showInterim = !entry.text && entry.interim;
  return (
    <div className={cx("flex animate-fade-up", seller ? "justify-end" : "justify-start")}>
      <div className={cx("max-w-[85%]", seller ? "items-end" : "items-start")}>
        <p className={cx("mb-1 text-[10px] font-semibold tracking-wide uppercase", seller ? "text-right text-sky-600" : "text-accent")}>
          {seller ? "Seller" : "Priya"}
        </p>
        <div
          className={cx(
            // overflow-wrap:anywhere keeps long or unexpected-script transcripts inside the bubble.
            "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]",
            seller ? "rounded-tr-md bg-sky-50 text-slate-800 ring-1 ring-sky-100" : "rounded-tl-md bg-slate-50 text-slate-800 ring-1 ring-slate-200/70",
          )}
        >
          {showInterim ? <span className="text-slate-400 italic">{entry.interim}</span> : displayText(entry)}
          {entry.open && !showInterim && <span className="ml-1 inline-block h-3 w-1 animate-pulse-dot rounded-sm bg-current align-middle opacity-40" />}
          {entry.interrupted && <span className="ml-2 text-[10px] font-medium text-amber-600">— interrupted</span>}
        </div>
      </div>
    </div>
  );
}
