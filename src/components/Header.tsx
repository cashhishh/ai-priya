"use client";
import type { CallMode, VoiceEngine } from "@/lib/types";
import type { CallStatus } from "@/lib/voice/types";
import { InfoIcon, LayersIcon, PhoneIcon, PhoneOffIcon, WaveIcon, cx } from "./ui";

const MODES: { id: CallMode; label: string; hint: string }[] = [
  { id: "inbound", label: "Inbound", hint: "Seller calls Priya (assignment scenario)" },
  { id: "proactive", label: "Proactive", hint: "Priya spots the drop and calls first" },
  { id: "follow_up", label: "Follow-up", hint: "Priya calls back using last call's memory" },
];

const STATUS: Record<CallStatus, { label: string; dot: string; text: string }> = {
  idle: { label: "Ready", dot: "bg-slate-300", text: "text-slate-500" },
  connecting: { label: "Connecting", dot: "bg-amber-400 animate-pulse-dot", text: "text-amber-700" },
  reconnecting: { label: "Reconnecting", dot: "bg-amber-400 animate-pulse-dot", text: "text-amber-700" },
  listening: { label: "Listening", dot: "bg-emerald-500 animate-pulse-dot", text: "text-emerald-700" },
  thinking: { label: "Thinking", dot: "bg-violet-500 animate-pulse-dot", text: "text-violet-700" },
  speaking: { label: "Speaking", dot: "bg-accent animate-pulse-dot", text: "text-accent" },
  ended: { label: "Call ended", dot: "bg-slate-400", text: "text-slate-500" },
};

export function StatusPill({ status }: { status: CallStatus }) {
  const s = STATUS[status];
  return (
    <span className={cx("inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium", s.text)} role="status" aria-live="polite">
      <span className={cx("h-2 w-2 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function Header(props: {
  mode: CallMode;
  onMode: (m: CallMode) => void;
  engine: VoiceEngine;
  onEngine: (e: VoiceEngine) => void;
  status: CallStatus;
  isActive: boolean;
  onStart: () => void;
  onEnd: () => void;
  onOpenAssumptions: () => void;
  onOpenHow: () => void;
  memoryLabel: string | null;
}) {
  const { mode, onMode, engine, onEngine, status, isActive } = props;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white shadow-sm shadow-accent/30">
            <WaveIcon size={18} />
          </div>
          <div className="leading-tight">
            <h1 className="text-[15px] font-semibold text-slate-900">
              Priya <span className="text-slate-300">·</span> AI Virtual KAM
            </h1>
            <p className="text-[11px] text-slate-500">Voice-first account manager for marketplace sellers</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Mode selector */}
          <div className="flex flex-col">
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="Call mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={mode === m.id}
                  title={m.hint}
                  disabled={isActive}
                  onClick={() => onMode(m.id)}
                  className={cx(
                    "rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed",
                    mode === m.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Engine toggle */}
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5" role="radiogroup" aria-label="Voice engine">
            {(["live", "fallback"] as const).map((e) => (
              <button
                key={e}
                role="radio"
                aria-checked={engine === e}
                disabled={isActive}
                onClick={() => onEngine(e)}
                title={e === "live" ? "Gemini Live native audio (real-time, barge-in)" : "Browser speech + Gemini text (works anywhere Chrome does)"}
                className={cx(
                  "rounded-[10px] px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed",
                  engine === e ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                {e === "live" ? "⚡ Live" : "Fallback"}
              </button>
            ))}
          </div>

          <StatusPill status={status} />

          <button onClick={props.onOpenAssumptions} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" title="Data & assumptions" aria-label="Data and assumptions">
            <InfoIcon size={18} />
          </button>
          <button onClick={props.onOpenHow} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" title="How it works" aria-label="How it works">
            <LayersIcon size={18} />
          </button>

          {isActive ? (
            <button
              onClick={props.onEnd}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 active:scale-[0.98]"
            >
              <PhoneOffIcon size={16} /> End call
            </button>
          ) : (
            <button
              onClick={props.onStart}
              className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-accent/25 transition hover:bg-accent-600 active:scale-[0.98]"
            >
              <PhoneIcon size={16} /> Start call
            </button>
          )}
        </div>
        {mode === "follow_up" && !isActive && (
          <p className="w-full text-right text-[11px] text-slate-500">
            {props.memoryLabel ?? "No previous call saved, so a clearly-labelled sample memory will be used."}
          </p>
        )}
      </div>
    </header>
  );
}
