/**
 * Pure reducer for everything the UI shows during a call. Both voice engines
 * feed it through the same SessionHandlers, so the UI is engine-agnostic.
 */
import { applyEventToActions, upsertInsight } from "@/lib/tools/context";
import type {
  ActionItem,
  CallMode,
  CallRecord,
  CallSummary,
  Diagnosis,
  Escalation,
  FollowUp,
  ProgressSnapshot,
  SellerInsight,
  ToolTrace,
  UiEvent,
  VoiceEngine,
} from "@/lib/types";
import type { CallError, CallStatus, TranscriptOp } from "@/lib/voice/types";

export interface TranscriptEntry {
  id: string;
  role: "seller" | "priya";
  text: string;
  /** In-progress recognition (shown in grey). */
  interim: string;
  open: boolean;
  interrupted?: boolean;
  /** ms timestamp when the bubble was created (used for ordering heuristics). */
  createdAt: number;
}

export type Section = "metrics" | "issues" | "insights" | "actions" | "followup" | "summary";

export interface CallState {
  status: CallStatus;
  mode: CallMode;
  engine: VoiceEngine;
  memory: CallRecord | null;
  startedAt: number | null;
  endedAt: number | null;
  transcript: TranscriptEntry[];
  traces: ToolTrace[];
  diagnosis: Diagnosis | null;
  metricsViewed: boolean;
  progress: ProgressSnapshot | null;
  insights: SellerInsight[];
  actions: ActionItem[];
  followUp: FollowUp | null;
  escalation: Escalation | null;
  summary: CallSummary | null;
  error: CallError | null;
  /** Timestamp of the last update per panel, used to flash a highlight. */
  updatedAt: Partial<Record<Section, number>>;
}

export type CallAction =
  | { type: "start"; mode: CallMode; engine: VoiceEngine; memory: CallRecord | null; at: number }
  | { type: "status"; status: CallStatus }
  | { type: "transcript"; op: TranscriptOp; at: number }
  | { type: "trace"; trace: ToolTrace }
  | { type: "ui_events"; events: UiEvent[]; at: number }
  | { type: "error"; error: CallError | null }
  | { type: "ended"; at: number; summary: CallSummary | null };

export function initialCallState(mode: CallMode = "inbound", engine: VoiceEngine = "live"): CallState {
  return {
    status: "idle",
    mode,
    engine,
    memory: null,
    startedAt: null,
    endedAt: null,
    transcript: [],
    traces: [],
    diagnosis: null,
    metricsViewed: false,
    progress: null,
    insights: [],
    actions: [],
    followUp: null,
    escalation: null,
    summary: null,
    error: null,
    updatedAt: {},
  };
}

let entrySeq = 0;
const newEntry = (role: TranscriptEntry["role"], at: number, text = "", interim = "", open = true): TranscriptEntry => ({
  id: `t${++entrySeq}`,
  role,
  text,
  interim,
  open,
  createdAt: at,
});

/** Window in which a seller transcript may still belong BEFORE a just-started Priya reply. */
const LATE_SELLER_WINDOW_MS = 2500;

/**
 * Join streamed chunks. Chunks normally carry their own spaces, but after
 * sentence punctuation we make sure there is one ("hai.Ramesh" → "hai. Ramesh").
 */
export function joinChunks(prev: string, next: string): string {
  if (!prev) return next;
  if (!next) return prev;
  if (/\s$/.test(prev) || /^\s/.test(next)) return prev + next;
  if (/[.!?।,;:]$/.test(prev) && /^[\p{L}\p{N}]/u.test(next)) return `${prev} ${next}`;
  return prev + next;
}

/**
 * Remove system cues like "[CALL_CONNECTED]" that the model may echo, plus a
 * half-streamed one at the end of an open bubble ("... [CALL_CONN").
 * Raw chunks stay in the open bubble so a cue split across chunks still
 * matches; display and closed bubbles use the cleaned text.
 */
export function stripCues(text: string): string {
  return text
    .replace(/\[\s*[A-Z][A-Z0-9_ ]{2,}\s*\]/g, " ")
    .replace(/\[[A-Z0-9_ ]*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** What the transcript shows for a bubble. */
export function displayText(entry: Pick<TranscriptEntry, "role" | "text">): string {
  return entry.role === "priya" ? stripCues(entry.text) : entry.text;
}

/**
 * Transcript assembly rules (Live audio streams both sides as chunks):
 *  - Each Priya turn is its own bubble: turn_complete and tool-call boundaries
 *    (priya_break) close the open bubble, and the next chunk starts a new one.
 *  - Seller text normally appends after everything (chronological order).
 *    One exception: if the seller's words arrive just after Priya STARTED
 *    replying to them (transcription lag), the seller bubble is placed before
 *    that reply. Never before the opening greeting, since that would put the
 *    greeting below the seller's first message.
 */
export function applyTranscriptOp(entries: TranscriptEntry[], op: TranscriptOp, at = 0): TranscriptEntry[] {
  const list = [...entries];
  const openIdx = (role: TranscriptEntry["role"]) => list.findIndex((e) => e.role === role && e.open);

  const closeAt = (i: number) => {
    const e = list[i];
    const raw = e.text || e.interim;
    const text = (e.role === "priya" ? stripCues(raw) : raw).trim();
    if (!text) list.splice(i, 1);
    else list[i] = { ...e, text, interim: "", open: false };
  };

  const ensureSeller = (): number => {
    const idx = openIdx("seller");
    if (idx >= 0) return idx;
    const priyaIdx = openIdx("priya");
    const entry = newEntry("seller", at);
    if (priyaIdx >= 0) {
      const priya = list[priyaIdx];
      const hasEarlierSeller = list.slice(0, priyaIdx).some((e) => e.role === "seller");
      const justStarted = at - priya.createdAt <= LATE_SELLER_WINDOW_MS;
      if (hasEarlierSeller && justStarted) {
        // Late transcription of what Priya is answering → goes before her reply.
        list.splice(priyaIdx, 0, entry);
        return priyaIdx;
      }
      // Otherwise Priya's bubble is finished (or interrupted): close it, then append.
      closeAt(priyaIdx);
    }
    list.push(entry);
    return list.length - 1;
  };

  const closeAll = () => {
    for (let i = list.length - 1; i >= 0; i--) if (list[i].open) closeAt(i);
  };

  switch (op.kind) {
    case "seller_interim": {
      const i = ensureSeller();
      list[i] = { ...list[i], interim: op.text };
      break;
    }
    case "seller_delta": {
      const i = ensureSeller();
      list[i] = { ...list[i], text: joinChunks(list[i].text, op.text), interim: "" };
      break;
    }
    case "seller_final": {
      const i = ensureSeller();
      list[i] = { ...list[i], text: op.text, interim: "", open: false };
      break;
    }
    case "priya_delta": {
      const i = openIdx("priya");
      if (i >= 0) list[i] = { ...list[i], text: joinChunks(list[i].text, op.text) };
      else list.push(newEntry("priya", at, op.text));
      break;
    }
    case "priya_full": {
      closeAll();
      const text = stripCues(op.text);
      if (text) list.push(newEntry("priya", at, text, "", false));
      break;
    }
    case "priya_break": {
      const i = openIdx("priya");
      if (i >= 0) closeAt(i);
      break;
    }
    case "interrupted": {
      const i = openIdx("priya");
      if (i >= 0) list[i] = { ...list[i], open: false, interrupted: true, text: stripCues(list[i].text) };
      else {
        // Fallback mode: the last Priya bubble was already closed.
        for (let j = list.length - 1; j >= 0; j--) {
          if (list[j].role === "priya") {
            list[j] = { ...list[j], interrupted: true };
            break;
          }
        }
      }
      break;
    }
    case "turn_complete":
      closeAll();
      break;
  }
  return list;
}

function upsertTrace(traces: ToolTrace[], t: ToolTrace): ToolTrace[] {
  const idx = traces.findIndex((x) => x.id === t.id);
  if (idx === -1) return t.name ? [...traces, t] : traces; // ignore cancellations for unknown ids
  const merged = { ...traces[idx], ...t, name: t.name || traces[idx].name, args: t.name ? t.args : traces[idx].args };
  return traces.map((x, i) => (i === idx ? merged : x));
}

function applyUiEvent(state: CallState, ev: UiEvent, at: number): CallState {
  const touch = (s: Section) => ({ ...state.updatedAt, [s]: at });
  switch (ev.type) {
    case "metrics_viewed":
      return { ...state, metricsViewed: true, progress: ev.progress ?? state.progress, updatedAt: touch("metrics") };
    case "diagnosis":
      return { ...state, diagnosis: ev.diagnosis, metricsViewed: true, updatedAt: { ...touch("issues"), metrics: at } };
    case "products_viewed":
      return state;
    case "insight_recorded":
      return { ...state, insights: upsertInsight(state.insights, ev.insight), updatedAt: touch("insights") };
    case "action_proposed":
    case "action_executed":
      return { ...state, actions: applyEventToActions(state.actions, ev), updatedAt: touch("actions") };
    case "follow_up_scheduled":
      return { ...state, followUp: ev.follow_up, updatedAt: touch("followup") };
    case "escalated":
      return { ...state, escalation: ev.escalation, updatedAt: touch("followup") };
    case "summary_ready":
      return { ...state, summary: ev.summary, updatedAt: touch("summary") };
    case "offer_declined":
      return state;
  }
}

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "start":
      return { ...initialCallState(action.mode, action.engine), memory: action.memory, startedAt: action.at, status: "connecting" };
    case "status":
      // Don't let late async status updates resurrect a finished call.
      if ((state.status === "ended" || state.status === "idle") && action.status !== "connecting") return state;
      return { ...state, status: action.status };
    case "transcript":
      return { ...state, transcript: applyTranscriptOp(state.transcript, action.op, action.at) };
    case "trace":
      return { ...state, traces: upsertTrace(state.traces, action.trace) };
    case "ui_events":
      return action.events.reduce((s, ev) => applyUiEvent(s, ev, action.at), state);
    case "error":
      return { ...state, error: action.error };
    case "ended":
      return {
        ...state,
        status: "ended",
        endedAt: action.at,
        summary: state.summary ?? action.summary,
        transcript: applyTranscriptOp(state.transcript, { kind: "turn_complete" }, action.at),
        traces: state.traces.map((t) => (t.status === "running" ? { ...t, status: "cancelled" } : t)),
      };
  }
}
