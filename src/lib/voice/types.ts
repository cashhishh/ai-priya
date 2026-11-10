/**
 * Engine-agnostic voice session contract. Both LiveSession (Gemini Live) and
 * FallbackSession (Web Speech + /api/chat) implement it, so the UI never
 * knows or cares which engine is running.
 */
import type { CallContext, ToolTrace, UiEvent } from "@/lib/types";

export type CallStatus = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "reconnecting" | "ended";

export type CallErrorKind = "mic_denied" | "unsupported" | "missing_key" | "live_failed" | "network" | "unknown";

export interface CallError {
  kind: CallErrorKind;
  message: string;
  /** If true the call cannot continue on this engine. */
  fatal: boolean;
}

/** Incremental transcript operations, applied by the UI reducer. */
export type TranscriptOp =
  /** Replace the seller's in-progress (grey) text. */
  | { kind: "seller_interim"; text: string }
  /** Commit the seller's full utterance (Fallback). */
  | { kind: "seller_final"; text: string }
  /** Append a committed chunk to the seller's utterance (Live streams transcription). */
  | { kind: "seller_delta"; text: string }
  | { kind: "priya_delta"; text: string }
  | { kind: "priya_full"; text: string }
  /** Close Priya's current bubble (e.g. at a tool call) so the next words start a new one. */
  | { kind: "priya_break" }
  | { kind: "turn_complete" }
  | { kind: "interrupted" };

export interface SessionHandlers {
  /** Latest call context snapshot (insights, actions, memory…) for tool execution. */
  getContext(): CallContext;
  onStatus(status: CallStatus): void;
  onTranscript(op: TranscriptOp): void;
  /** Upsert a tool trace (same id → update). */
  onToolTrace(trace: ToolTrace): void;
  onUiEvents(events: UiEvent[]): void;
  onError(error: CallError): void;
  /** Priya has said goodbye after the summary: the UI should hang up. */
  onCallShouldEnd(): void;
}

export interface AudioLevels {
  user: number; // 0..1
  bot: number; // 0..1
}

export interface VoiceSession {
  start(): Promise<void>;
  stop(): void;
  /** Polled by the visualiser on every animation frame (no React re-render). */
  getLevels(): AudioLevels;
  /** Manual barge-in (Fallback mode: tap to interrupt). Live handles it server-side. */
  interrupt(): void;
}

export function errorFromUnknown(err: unknown, kind: CallErrorKind = "unknown", fatal = true): CallError {
  if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
    return { kind: "mic_denied", message: "Microphone access was blocked. Allow the mic in the address bar and try again.", fatal: true };
  }
  if (err instanceof DOMException && err.name === "NotFoundError") {
    return { kind: "mic_denied", message: "No microphone was found. Plug one in and try again.", fatal: true };
  }
  return { kind, message: err instanceof Error ? err.message : String(err), fatal };
}
