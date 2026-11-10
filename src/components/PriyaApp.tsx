"use client";
import { useEffect, useState } from "react";
import { useCall } from "@/hooks/useCall";
import { prettyDate } from "@/lib/tools/summary";
import { AgentBrain } from "./AgentBrain";
import { CallPanel } from "./CallPanel";
import { AssumptionsContent, Drawer, HowItWorksContent } from "./Drawers";
import { ErrorBanner, KeyMissingBanner } from "./ErrorBanner";
import { Header } from "./Header";
import { Seller360 } from "./Seller360";
import { SummaryModal } from "./SummaryModal";

export function PriyaApp() {
  const call = useCall();
  const { state } = call;
  const [drawer, setDrawer] = useState<"assumptions" | "how" | null>(null);

  // Space = interrupt Priya (useful in Fallback mode, where barge-in is manual).
  const { isActive, interrupt } = call;
  useEffect(() => {
    if (!isActive) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.code !== "Space" || target?.closest("input, textarea, button, select")) return;
      e.preventDefault();
      interrupt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, interrupt]);

  const memoryLabel = call.lastCall
    ? `Using memory from the call on ${prettyDate(call.lastCall.date)} (${call.lastCall.insights.length} insights, ${call.lastCall.actions.length} actions).`
    : null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        mode={call.mode}
        onMode={call.setMode}
        engine={call.engine}
        onEngine={call.setEngine}
        status={state.status}
        isActive={call.isActive}
        onStart={() => void call.startCall()}
        onEnd={call.endCall}
        onOpenAssumptions={() => setDrawer("assumptions")}
        onOpenHow={() => setDrawer("how")}
        memoryLabel={memoryLabel}
      />

      {call.health && !call.health.hasKey && <KeyMissingBanner />}
      {state.error && (
        <ErrorBanner error={state.error} engine={call.engine} onDismiss={call.dismissError} onSwitchToFallback={call.switchToFallback} />
      )}

      <main className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(0,1.1fr)]">
        <div className="min-w-0 xl:sticky xl:top-[84px] xl:h-[calc(100vh-100px)]">
          <CallPanel
            status={state.status}
            engine={state.status === "idle" ? call.engine : state.engine}
            mode={call.mode}
            transcript={state.transcript}
            startedAt={state.startedAt}
            endedAt={state.endedAt}
            getLevels={call.getLevels}
            onInterrupt={call.interrupt}
          />
        </div>
        <div className="min-w-0 xl:sticky xl:top-[84px] xl:h-[calc(100vh-100px)]">
          <AgentBrain traces={state.traces} active={call.isActive} />
        </div>
        <div className="min-w-0 lg:col-span-2 xl:col-span-1">
          <Seller360 state={state} />
          {state.status === "ended" && state.summary && !call.showSummary && (
            <button
              onClick={() => call.setShowSummary(true)}
              className="mt-4 w-full rounded-2xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent-100"
            >
              View call summary & WhatsApp message →
            </button>
          )}
        </div>
      </main>

      <footer className="mx-auto w-full max-w-[1500px] px-4 pb-6 text-[11px] text-slate-400 sm:px-6">
        Prototype for a hiring assignment. Seller data is mock (see Data &amp; assumptions). ₹ figures are estimates from deterministic code.
      </footer>

      {call.showSummary && state.summary && (
        <SummaryModal summary={state.summary} actions={state.actions} followUp={state.followUp} onClose={() => call.setShowSummary(false)} />
      )}
      {drawer === "assumptions" && (
        <Drawer title="Data & assumptions" onClose={() => setDrawer(null)}>
          <AssumptionsContent lastCall={call.lastCall} onResetMemory={call.resetMemory} />
        </Drawer>
      )}
      {drawer === "how" && (
        <Drawer title="How it works" onClose={() => setDrawer(null)}>
          <HowItWorksContent />
        </Drawer>
      )}
    </div>
  );
}
