"use client";
/**
 * useCall: the single controller for a call.
 *  - creates the chosen engine (Live or Fallback) with shared handlers
 *  - keeps a synchronous CallContext ref for tool execution
 *  - persists the call to memory when it ends (with a local summary if needed)
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { callReducer, initialCallState, type CallState } from "@/lib/call-state";
import { FallbackSession } from "@/lib/fallback/fallback-session";
import { LiveSession } from "@/lib/live/live-session";
import { loadLastCall, resetMemory as clearMemory, sampleMemory, saveCall } from "@/lib/memory";
import { applyEventToContext } from "@/lib/tools/context";
import { updateSignals } from "@/lib/tools/signals";
import { buildLocalSummary } from "@/lib/tools/summary";
import type { CallContext, CallMode, CallRecord, VoiceEngine } from "@/lib/types";
import type { CallError, SessionHandlers, VoiceSession } from "@/lib/voice/types";

export interface HealthInfo {
  hasKey: boolean;
  liveModel: string;
  textModel: string;
}

export function useCall() {
  const [mode, setMode] = useState<CallMode>("inbound");
  const [engine, setEngine] = useState<VoiceEngine>("live");
  const [state, dispatch] = useReducer(callReducer, undefined, () => initialCallState());
  const [lastCall, setLastCall] = useState<CallRecord | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const sessionRef = useRef<VoiceSession | null>(null);
  const ctxRef = useRef<CallContext | null>(null);
  const stateRef = useRef<CallState>(state);
  const endingRef = useRef(false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load memory + server health once on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
    setLastCall(loadLastCall());
    fetch("/api/health")
      .then((r) => r.json() as Promise<HealthInfo>)
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const isActive = !["idle", "ended"].includes(state.status);

  /** Finish the call: stop audio, build a summary if Priya didn't, save memory. */
  const endCall = useCallback(() => {
    if (endingRef.current) return;
    endingRef.current = true;
    sessionRef.current?.stop();
    sessionRef.current = null;

    const s = stateRef.current;
    const now = new Date().toISOString();
    const hadContent = s.diagnosis || s.actions.length || s.insights.length || s.transcript.length > 1;
    const summary =
      s.summary ??
      (hadContent
        ? buildLocalSummary({ actions: s.actions, followUp: s.followUp, createdAt: now })
        : null);

    dispatch({ type: "ended", at: Date.now(), summary });

    if (hadContent) {
      const record: CallRecord = {
        id: `call_${Date.now()}`,
        date: now,
        mode: s.mode,
        insights: s.insights,
        actions: s.actions,
        follow_up: s.followUp,
        summary,
      };
      saveCall(record);
      setLastCall(record);
      setShowSummary(true);
    }
  }, []);

  const startCall = useCallback(async () => {
    if (sessionRef.current) return;
    endingRef.current = false;
    // Follow-up mode uses the last real call, or a clearly-labelled sample.
    const memory = mode === "follow_up" ? (loadLastCall() ?? sampleMemory()) : null;
    ctxRef.current = { mode, insights: [], actions: [], follow_up: null, memory, now_iso: new Date().toISOString(), diagnosed: false, escalated: false, declined_offers: [], signals: {} };
    dispatch({ type: "start", mode, engine, memory, at: Date.now() });
    setShowSummary(false);

    const handlers: SessionHandlers = {
      getContext: () => ({ ...(ctxRef.current as CallContext), now_iso: new Date().toISOString() }),
      onStatus: (status) => dispatch({ type: "status", status }),
      onTranscript: (op) => {
        const at = Date.now();
        // Track who spoke when, synchronously, so the next tool call sees it.
        if (ctxRef.current) ctxRef.current = { ...ctxRef.current, signals: updateSignals(ctxRef.current.signals, op, at) };
        dispatch({ type: "transcript", op, at });
      },
      onToolTrace: (trace) => dispatch({ type: "trace", trace }),
      onUiEvents: (events) => {
        // Update the context synchronously so the next tool call sees it.
        for (const ev of events) if (ctxRef.current) ctxRef.current = applyEventToContext(ctxRef.current, ev);
        dispatch({ type: "ui_events", events, at: Date.now() });
      },
      onError: (error: CallError) => {
        dispatch({ type: "error", error });
        if (error.fatal) endCall();
      },
      onCallShouldEnd: () => endCall(),
    };

    const session: VoiceSession = engine === "live" ? new LiveSession(handlers) : new FallbackSession(handlers);
    sessionRef.current = session;
    await session.start();
  }, [mode, engine, endCall]);

  const interrupt = useCallback(() => sessionRef.current?.interrupt(), []);
  const getLevels = useCallback(() => sessionRef.current?.getLevels() ?? { user: 0, bot: 0 }, []);
  const dismissError = useCallback(() => dispatch({ type: "error", error: null }), []);

  const resetMemory = useCallback(() => {
    clearMemory();
    setLastCall(null);
  }, []);

  /** One-click recovery from a Live failure: switch engine and redial. */
  const [redialOnFallback, setRedialOnFallback] = useState(false);
  const switchToFallback = useCallback(() => {
    setEngine("fallback");
    dispatch({ type: "error", error: null });
    setRedialOnFallback(true);
  }, []);
  useEffect(() => {
    // Runs after the engine state has updated, so startCall uses the fallback engine.
    if (redialOnFallback && engine === "fallback" && !sessionRef.current) {
      setRedialOnFallback(false);
      void startCall();
    }
  }, [redialOnFallback, engine, startCall]);

  // Stop audio if the page unmounts mid-call.
  useEffect(() => () => sessionRef.current?.stop(), []);

  return {
    state,
    mode,
    setMode,
    engine,
    setEngine,
    isActive,
    lastCall,
    health,
    showSummary,
    setShowSummary,
    startCall,
    endCall,
    interrupt,
    getLevels,
    dismissError,
    resetMemory,
    switchToFallback,
  };
}
