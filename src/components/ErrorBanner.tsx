"use client";
import type { VoiceEngine } from "@/lib/types";
import type { CallError } from "@/lib/voice/types";
import { AlertIcon, XIcon } from "./ui";

const TITLES: Record<CallError["kind"], string> = {
  mic_denied: "Microphone blocked",
  unsupported: "Browser not supported",
  missing_key: "API key missing",
  live_failed: "Live voice couldn't connect",
  network: "Connection hiccup",
  unknown: "Something went wrong",
};

export function ErrorBanner({
  error,
  engine,
  onDismiss,
  onSwitchToFallback,
}: {
  error: CallError;
  engine: VoiceEngine;
  onDismiss: () => void;
  onSwitchToFallback: () => void;
}) {
  const offerFallback = engine === "live" && (error.kind === "live_failed" || error.kind === "unsupported" || error.kind === "network");
  return (
    <div className="mx-auto mt-4 max-w-[1500px] px-4 sm:px-6">
      <div className="flex animate-fade-up items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
        <AlertIcon size={18} className="mt-0.5 shrink-0 text-red-500" />
        <div className="flex-1">
          <p className="font-semibold">{TITLES[error.kind]}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-red-800">
            {error.message}
            {error.kind === "missing_key" && " Create .env.local with GEMINI_API_KEY=… (see .env.example), then restart the dev server."}
          </p>
          {offerFallback && (
            <button onClick={onSwitchToFallback} className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700">
              Switch to Fallback voice and try again
            </button>
          )}
        </div>
        <button onClick={onDismiss} className="rounded-lg p-1 text-red-400 hover:bg-red-100 hover:text-red-700" aria-label="Dismiss">
          <XIcon size={16} />
        </button>
      </div>
    </div>
  );
}

export function KeyMissingBanner() {
  return (
    <div className="mx-auto mt-4 max-w-[1500px] px-4 sm:px-6">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <AlertIcon size={16} className="mt-0.5 shrink-0 text-amber-500" />
        <p>
          <b>GEMINI_API_KEY is not configured on the server.</b> Copy <code>.env.example</code> to <code>.env.local</code>, add your key from Google AI Studio,
          and restart <code>npm run dev</code> (on Vercel: Project → Settings → Environment Variables).
        </p>
      </div>
    </div>
  );
}
