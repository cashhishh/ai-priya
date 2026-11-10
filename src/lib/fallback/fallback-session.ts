/**
 * Fallback voice engine: Web Speech STT → POST /api/chat → speechSynthesis.
 *
 * Turn-taking state machine:
 *   listening ──(final text + 900ms quiet)──▶ thinking ──(reply)──▶ speaking ──(done)──▶ listening
 *        ▲                                                            │
 *        └────────────────── interrupt() (tap / Space) ───────────────┘
 *
 * Recognition is paused while Priya speaks so it doesn't hear itself.
 */
import type { Content } from "@google/genai";
import type { ApiError, ChatResponse } from "./api-types";
import { Recognizer, isSpeechRecognitionSupported } from "./speech-recognition";
import { Speaker, isTtsSupported } from "./tts";
import { CALL_CONNECTED_CUE } from "@/lib/prompts";
import { LevelMeter, getMicStream } from "@/lib/voice/level-meter";
import { errorFromUnknown, type AudioLevels, type SessionHandlers, type VoiceSession } from "@/lib/voice/types";

const END_OF_UTTERANCE_MS = 900;

export class FallbackSession implements VoiceSession {
  private recognizer: Recognizer | null = null;
  private speaker = new Speaker();
  private history: Content[] = [];
  private pendingText = "";
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private busy = false; // waiting for /api/chat
  private endAfterSpeaking = false;
  private abort: AbortController | null = null;

  private micStream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private meter: LevelMeter | null = null;

  constructor(private readonly h: SessionHandlers) {}

  async start(): Promise<void> {
    if (!isSpeechRecognitionSupported() || !isTtsSupported()) {
      this.h.onError({
        kind: "unsupported",
        message: "Fallback mode needs browser speech recognition. Please use the latest Google Chrome or Microsoft Edge on desktop.",
        fatal: true,
      });
      return;
    }
    this.active = true;
    this.h.onStatus("connecting");
    try {
      // Opening the mic ourselves gives a clear permission prompt + a level meter.
      this.micStream = await getMicStream();
      this.audioCtx = new AudioContext();
      const analyser = this.audioCtx.createAnalyser();
      this.audioCtx.createMediaStreamSource(this.micStream).connect(analyser);
      this.meter = new LevelMeter(analyser);
      await this.speaker.init();
    } catch (err) {
      this.active = false;
      this.h.onError(errorFromUnknown(err));
      return;
    }

    this.recognizer = new Recognizer({
      onInterim: (text) => {
        if (!this.active || this.busy || this.speaker.isSpeaking) return;
        this.h.onTranscript({ kind: "seller_interim", text: `${this.pendingText} ${text}`.trim() });
        this.scheduleFlush(); // keep waiting while they talk
      },
      onFinal: (text) => {
        if (!this.active || this.busy || this.speaker.isSpeaking) return;
        this.pendingText = `${this.pendingText} ${text}`.trim();
        this.h.onTranscript({ kind: "seller_interim", text: this.pendingText });
        this.scheduleFlush();
      },
      onFatalError: (kind, message) => this.h.onError({ kind, message, fatal: true }),
    });

    // The "phone system" tells Priya the call is connected; she speaks first.
    await this.send(CALL_CONNECTED_CUE, false);
  }

  stop(): void {
    this.active = false;
    this.abort?.abort();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.recognizer?.dispose();
    this.speaker.cancel();
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => undefined);
    this.h.onStatus("ended");
  }

  getLevels(): AudioLevels {
    const user = this.meter && !this.speaker.isSpeaking ? this.meter.read() : 0;
    return { user, bot: this.speaker.level() };
  }

  /** Tap-to-interrupt: stop Priya mid-sentence and listen. */
  interrupt(): void {
    if (!this.speaker.isSpeaking) return;
    this.speaker.cancel();
    this.h.onTranscript({ kind: "interrupted" });
    this.listen();
  }

  // ---------------------------------------------------------------------------

  private listen(): void {
    if (!this.active) return;
    this.h.onStatus("listening");
    this.recognizer?.resume();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      const text = this.pendingText.trim();
      if (!text) return;
      this.pendingText = "";
      void this.send(text, true);
    }, END_OF_UTTERANCE_MS);
  }

  private async send(message: string, fromSeller: boolean): Promise<void> {
    if (!this.active || this.busy) return;
    this.busy = true;
    this.recognizer?.pause();
    if (fromSeller) {
      this.h.onTranscript({ kind: "seller_final", text: message });
      // The seller spoke after the summary: keep the call going (re-armed if Priya wraps up again).
      this.endAfterSpeaking = false;
    }
    this.h.onStatus("thinking");

    let data: ChatResponse;
    try {
      this.abort = new AbortController();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: this.history, message, context: this.h.getContext() }),
        signal: this.abort.signal,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as ApiError | null;
        if (err?.error === "missing_api_key") {
          this.h.onError({ kind: "missing_key", message: err.message, fatal: true });
          return;
        }
        throw new Error(err?.message ?? `Server error ${res.status}`);
      }
      data = (await res.json()) as ChatResponse;
    } catch (err) {
      if (!this.active) return;
      this.h.onError(errorFromUnknown(err, "network", false));
      this.busy = false;
      // Recover gracefully: apologise locally and keep listening.
      await this.say("Sorry, network thoda slow hai. Could you say that again?");
      this.listen();
      return;
    } finally {
      this.abort = null;
    }

    if (!this.active) return;
    this.history = data.history;
    data.traces.forEach((t) => this.h.onToolTrace(t));
    if (data.uiEvents.length) this.h.onUiEvents(data.uiEvents);
    if (data.uiEvents.some((e) => e.type === "summary_ready")) this.endAfterSpeaking = true;
    this.busy = false;

    const outcome = await this.say(data.reply);
    if (!this.active) return;
    if (outcome === "done" && this.endAfterSpeaking) {
      this.h.onCallShouldEnd();
      return;
    }
    this.listen();
  }

  private async say(text: string): Promise<"done" | "cancelled"> {
    this.h.onTranscript({ kind: "priya_full", text });
    this.h.onStatus("speaking");
    return this.speaker.speak(text);
  }
}
