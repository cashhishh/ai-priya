/**
 * Primary voice engine: Gemini Live native-audio over a WebSocket opened
 * directly from the browser with an ephemeral token.
 *
 *   mic ─▶ AudioWorklet (16k PCM16) ─▶ sendRealtimeInput ─▶ Gemini Live
 *   speaker ◀─ AudioPlayer (24k PCM) ◀─ serverContent.modelTurn audio ◀─┘
 *                     toolCall ─▶ executeTool (shared) ─▶ sendToolResponse
 *
 * Responsibilities:
 *  - barge-in: `serverContent.interrupted` → flush playback instantly
 *  - live input + output transcription
 *  - function calling with responses sent back by id
 *  - session resumption: reconnect on goAway / unexpected close
 *  - initial-connect retry with the other API version (SDK/docs mismatch)
 */
import { GoogleGenAI, Modality, type LiveConnectConfig, type LiveServerMessage, type Session } from "@google/genai";
import { CALL_CONNECTED_CUE, SELLER_SAID_HELLO_CUE, buildSystemPrompt } from "@/lib/prompts";
import { applyEventToContext } from "@/lib/tools/context";
import { LIVE_FUNCTION_DECLARATIONS } from "@/lib/tools/declarations";
import { executeTool, traceStatus } from "@/lib/tools/executor";
import type { AudioLevels, SessionHandlers, VoiceSession } from "@/lib/voice/types";
import { errorFromUnknown } from "@/lib/voice/types";
import { AudioCapture } from "./audio-capture";
import { AudioPlayer } from "./audio-player";
import type { LiveTokenResponse } from "./token-types";

const VOICE_NAME = "Kore"; // warm, clear female prebuilt voice

/**
 * Input-transcription hints. Without them, short Hinglish utterances are
 * sometimes transcribed as Spanish or another language. The SDK exposes
 * AudioTranscriptionConfig.languageCodes (BCP-47 hints) and customVocabulary,
 * but the Live docs do not document them for every model, so if setup is
 * rejected we automatically reconnect without the hints.
 */
const TRANSCRIPTION_HINTS = {
  languageCodes: ["hi-IN", "en-IN"],
  customVocabulary: ["Priya", "restock", "listing", "out of stock", "supplier", "cancellation", "pressure cooker", "bedsheet", "tawa", "Jaipur"],
};
const MAX_RECONNECTS = 3;
const THINKING_DELAY_MS = 700;
const END_CALL_SAFETY_MS = 20_000;
/** Seller transcription arriving this soon after end_call_summary is the tail of their previous words. */
const LATE_TRANSCRIPT_GRACE_MS = 1_500;
/** Pre-connect mic buffer: up to 8 s of 40 ms chunks. */
const PRE_CONNECT_MAX_CHUNKS = 200;
/** A 40 ms chunk this loud counts as speech (silence after noise suppression is ~0.005). */
const SPEECH_RMS = 0.03;
/** ≥ 200 ms of speech = the seller said something while we were connecting. */
const SPEECH_MIN_CHUNKS = 5;
/** If the replayed "hello" gets no reply in this long, send the connect cue anyway. */
const GREET_SAFETY_MS = 2_500;

/**
 * Hang-up state after end_call_summary:
 *  idle → awaiting_goodbye (tool ran) → goodbye_playing (goodbye audio arrived)
 *  → hang up once that turn completes AND the audio has fully played.
 * If the seller speaks again, go back to idle and keep the call open.
 */
type EndPhase = "idle" | "awaiting_goodbye" | "goodbye_playing";

/**
 * Dev-only turn log. If a turn gets no reply, the console shows where it
 * stopped: seller turn → model turn started → audio chunks → turnComplete.
 */
const DEBUG = process.env.NODE_ENV !== "production";

class TurnLog {
  private turn = 0;
  private sellerOpen = false;
  private modelOpen = false;
  private chunks = 0;
  private start = 0;

  private log(msg: string): void {
    if (DEBUG) console.log(`[live #${this.turn}] ${msg}`);
  }
  seller(text: string): void {
    if (!this.sellerOpen) {
      this.sellerOpen = true;
      this.turn++;
      this.start = Date.now();
      this.log("seller turn received");
    }
    this.log(`  seller: "${text.trim()}"`);
  }
  modelAudio(): void {
    if (!this.modelOpen) {
      this.modelOpen = true;
      this.chunks = 0;
      this.log(`model turn started (+${this.start ? Date.now() - this.start : 0}ms after seller)`);
    }
    this.chunks++;
  }
  modelText(text: string): void {
    if (!this.modelOpen) this.log("model transcript arrived before any audio");
    this.log(`  priya: "${text.trim()}"`);
  }
  tool(name: string, status: string, detail?: string): void {
    this.log(`tool ${name} → ${status}${detail ? `: ${detail}` : ""}`);
  }
  interrupted(): void {
    this.log(`interrupted (barge-in) after ${this.chunks} audio chunks`);
    this.modelOpen = false;
  }
  generationComplete(): void {
    this.log(`generationComplete (${this.chunks} audio chunks so far)`);
  }
  turnComplete(): void {
    this.log(this.modelOpen ? `turnComplete: ${this.chunks} audio chunks` : "turnComplete with NO model audio in this turn");
    this.modelOpen = false;
    this.sellerOpen = false;
    this.chunks = 0;
  }
  note(msg: string): void {
    this.log(msg);
  }
}

class TokenError extends Error {
  constructor(message: string, readonly missingKey: boolean) {
    super(message);
  }
}

async function fetchToken(apiVersion?: string): Promise<LiveTokenResponse> {
  const res = await fetch(`/api/live-token${apiVersion ? `?apiVersion=${apiVersion}` : ""}`, { method: "POST" });
  const body = (await res.json().catch(() => ({}))) as Partial<LiveTokenResponse> & { error?: string; message?: string };
  if (!res.ok || !body.token || !body.model || !body.apiVersion) {
    throw new TokenError(body.message ?? `Token request failed (${res.status})`, body.error === "missing_api_key");
  }
  return body as LiveTokenResponse;
}

export class LiveSession implements VoiceSession {
  private session: Session | null = null;
  private capture: AudioCapture;
  private player = new AudioPlayer();
  private token: LiveTokenResponse | null = null;

  private stopped = false;
  private setupComplete = false;
  private everConnected = false;
  private triedOtherVersion = false;
  private useTranscriptionHints = true;
  private resumeHandle: string | null = null;
  private reconnects = 0;
  private reconnecting = false;

  private endPhase: EndPhase = "idle";
  private endArmedAt = 0;
  private endSafetyTimer: ReturnType<typeof setTimeout> | null = null;
  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private botTurnOpen = false;
  private turnLog = new TurnLog();

  /**
   * Mic audio captured BEFORE the first setupComplete (token fetch + connect
   * takes 1-3 s). It used to be dropped, so a "hello" said right after
   * pressing Call never reached Gemini. Now it is kept and replayed.
   */
  private preConnect: string[] = [];
  private preConnectSpeechChunks = 0;
  private greetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly h: SessionHandlers) {
    this.capture = new AudioCapture((data, rms) => {
      // Stream mic continuously; Gemini's server-side VAD decides turns and barge-in.
      if (this.session && this.setupComplete && !this.reconnecting) {
        this.session.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
      } else if (!this.everConnected) {
        this.preConnect.push(data);
        if (this.preConnect.length > PRE_CONNECT_MAX_CHUNKS) this.preConnect.shift();
        if (rms >= SPEECH_RMS) this.preConnectSpeechChunks++;
      }
    });
  }

  /**
   * First setupComplete: start the conversation.
   *  - Seller already spoke while connecting (inbound call): replay their audio
   *    so Gemini hears the "hello" (it shows in the transcript) and answers it.
   *    If nothing comes back within GREET_SAFETY_MS, fall back to the cue.
   *  - Otherwise (or proactive / follow-up calls, which must run a tool first):
   *    send the [CALL_CONNECTED] cue so Priya speaks first.
   */
  private startConversation(): void {
    const spoke = this.preConnectSpeechChunks >= SPEECH_MIN_CHUNKS;
    const buffered = this.preConnect;
    this.preConnect = [];
    const mode = this.h.getContext().mode;
    if (spoke && mode === "inbound") {
      this.turnLog.note(`seller spoke while connecting: replaying ${buffered.length} buffered chunks (~${buffered.length * 40}ms)`);
      for (const data of buffered) this.session?.sendRealtimeInput({ audio: { data, mimeType: "audio/pcm;rate=16000" } });
      this.greetTimer = setTimeout(() => {
        this.greetTimer = null;
        if (this.stopped) return;
        this.turnLog.note("no reply to the replayed audio; sending CALL_CONNECTED cue");
        this.sendConnectedCue(true);
      }, GREET_SAFETY_MS);
      return;
    }
    this.sendConnectedCue(spoke);
  }

  private sendConnectedCue(sellerAlreadySpoke: boolean): void {
    // The "phone system" tells Priya the call is live, so she speaks first.
    const text = sellerAlreadySpoke ? `${CALL_CONNECTED_CUE} ${SELLER_SAID_HELLO_CUE}` : CALL_CONNECTED_CUE;
    this.session?.sendClientContent({ turns: [{ role: "user", parts: [{ text }] }], turnComplete: true });
    this.turnLog.note(`sent ${text}`);
    this.h.onStatus("thinking");
  }

  /** Anything from the server that shows the conversation has started cancels the fallback cue. */
  private cancelGreetFallback(): void {
    if (this.greetTimer) clearTimeout(this.greetTimer);
    this.greetTimer = null;
  }

  async start(): Promise<void> {
    if (!AudioCapture.isSupported()) {
      this.h.onError({ kind: "unsupported", message: "This browser doesn't support real-time audio. Please use the latest Chrome or Edge.", fatal: true });
      return;
    }
    this.h.onStatus("connecting");
    try {
      // Audio first, while we still have the click's user activation.
      await this.player.start();
      await this.capture.start();
    } catch (err) {
      this.h.onError(errorFromUnknown(err));
      this.teardown();
      return;
    }
    try {
      this.token = await fetchToken();
      await this.connect();
    } catch (err) {
      if (err instanceof TokenError && err.missingKey) {
        this.h.onError({ kind: "missing_key", message: err.message, fatal: true });
      } else {
        this.h.onError({ kind: "live_failed", message: `Couldn't start the Live session: ${err instanceof Error ? err.message : String(err)}`, fatal: true });
      }
      this.teardown();
    }
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    this.h.onStatus("ended");
  }

  getLevels(): AudioLevels {
    return { user: this.capture.getLevel(), bot: this.player.getLevel() };
  }

  /** Live mode barge-in is automatic (server VAD); this is a manual "stop talking" button. */
  interrupt(): void {
    if (this.player.isPlaying) {
      this.player.flush();
      this.h.onTranscript({ kind: "interrupted" });
      this.h.onStatus("listening");
    }
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  private buildConfig(): LiveConnectConfig {
    const ctx = this.h.getContext();
    return {
      responseModalities: [Modality.AUDIO],
      systemInstruction: buildSystemPrompt({ mode: ctx.mode, memory: ctx.memory, nowIso: ctx.now_iso }),
      tools: [{ functionDeclarations: LIVE_FUNCTION_DECLARATIONS }],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE_NAME } } },
      inputAudioTranscription: this.useTranscriptionHints ? TRANSCRIPTION_HINTS : {},
      outputAudioTranscription: {},
      // Resumption lets us survive goAway / network blips without losing context.
      sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
      // Sliding window lifts the 15-minute audio session limit.
      contextWindowCompression: { slidingWindow: {} },
    };
  }

  private async connect(): Promise<void> {
    if (!this.token) throw new Error("No token");
    const isResume = Boolean(this.resumeHandle);
    this.setupComplete = false;
    const ai = new GoogleGenAI({ apiKey: this.token.token, httpOptions: { apiVersion: this.token.apiVersion } });
    this.session = await ai.live.connect({
      model: this.token.model,
      config: this.buildConfig(),
      callbacks: {
        onopen: () => undefined,
        onmessage: (msg) => this.onMessage(msg, isResume),
        onerror: (e) => console.warn("[live] socket error", e),
        onclose: (e) => void this.onClose(e),
      },
    });
  }

  private async onClose(e: CloseEvent): Promise<void> {
    this.session = null;
    if (this.stopped) return;
    const reason = e.reason || `code ${e.code}`;

    // 1) Never got going. First retry without the transcription hints (the most
    //    likely thing to be rejected), then with the other API version.
    if (!this.everConnected) {
      if (this.useTranscriptionHints && this.token) {
        this.useTranscriptionHints = false;
        console.warn("[live] setup failed with transcription hints; retrying without them:", reason);
        try {
          this.token = await fetchToken(this.token.apiVersion);
          await this.connect();
          return;
        } catch {
          /* fall through to the API-version retry */
        }
      }
      if (!this.triedOtherVersion && this.token) {
        this.triedOtherVersion = true;
        const other = this.token.apiVersion === "v1alpha" ? "v1beta" : "v1alpha";
        try {
          this.token = await fetchToken(other);
          await this.connect();
          return;
        } catch {
          /* fall through to the error below */
        }
      }
      this.h.onError({ kind: "live_failed", message: `Live connection was refused (${reason}).`, fatal: true });
      this.teardown();
      return;
    }

    // 2) Dropped mid-call: resume with the handle (same token first, then a fresh one).
    if (this.resumeHandle && this.reconnects < MAX_RECONNECTS) {
      this.reconnects++;
      this.reconnecting = true;
      this.h.onStatus("reconnecting");
      await new Promise((r) => setTimeout(r, 300 * this.reconnects));
      try {
        await this.connect();
      } catch {
        try {
          this.token = await fetchToken(this.token?.apiVersion);
          await this.connect();
        } catch (err) {
          this.reconnecting = false;
          this.h.onError({ kind: "live_failed", message: `Lost the Live connection and couldn't reconnect: ${errorFromUnknown(err).message}`, fatal: true });
          this.teardown();
        }
      }
      return;
    }

    this.h.onError({ kind: "live_failed", message: `The Live connection closed (${reason}).`, fatal: true });
    this.teardown();
  }

  // ---------------------------------------------------------------------------
  // Server messages
  // ---------------------------------------------------------------------------

  private onMessage(msg: LiveServerMessage, isResume: boolean): void {
    if (msg.setupComplete) {
      this.setupComplete = true;
      this.reconnecting = false;
      if (!this.everConnected) {
        this.everConnected = true;
        this.h.onStatus("listening");
        this.turnLog.note(`setupComplete (${this.preConnect.length} chunks buffered while connecting, ${this.preConnectSpeechChunks} with speech)`);
        this.startConversation();
      } else if (isResume) {
        this.reconnects = 0;
        this.h.onStatus(this.player.isPlaying ? "speaking" : "listening");
      }
    }

    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = msg.sessionResumptionUpdate.newHandle;
    }

    if (msg.goAway) {
      this.turnLog.note("goAway: reconnecting with the resumption handle");
      // Server will close soon: reconnect proactively with the resumption handle.
      this.session?.close();
    }

    if (msg.toolCall?.functionCalls?.length) {
      this.turnLog.note(`toolCall: ${msg.toolCall.functionCalls.map((f) => f.name).join(", ")}`);
      this.handleToolCall(msg);
    }

    if (msg.toolCallCancellation?.ids) {
      for (const id of msg.toolCallCancellation.ids) {
        this.turnLog.tool(id, "cancelled");
        this.h.onToolTrace({ id, name: "", args: {}, status: "cancelled", started_at: Date.now() });
      }
    }

    const sc = msg.serverContent;
    if (!sc) return;
    if (this.greetTimer && (sc.inputTranscription?.text || sc.modelTurn?.parts?.length)) this.cancelGreetFallback();

    if (sc.interrupted) {
      this.turnLog.interrupted();
      // BARGE-IN: the seller started talking, so stop Priya instantly.
      this.player.flush();
      this.botTurnOpen = false;
      this.h.onTranscript({ kind: "interrupted" });
      this.h.onStatus("listening");
    }

    if (sc.interimInputTranscription?.text) {
      this.h.onTranscript({ kind: "seller_interim", text: sc.interimInputTranscription.text });
    }
    if (sc.inputTranscription?.text) {
      this.turnLog.seller(sc.inputTranscription.text);
      this.h.onTranscript({ kind: "seller_delta", text: sc.inputTranscription.text });
      this.scheduleThinking();
      // The seller is talking again after the summary: don't hang up on them.
      if (this.endPhase !== "idle" && /[\p{L}\p{N}]{2,}/u.test(sc.inputTranscription.text) && Date.now() - this.endArmedAt > LATE_TRANSCRIPT_GRACE_MS) {
        this.disarmEndOfCall();
      }
    }

    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) {
        this.turnLog.modelAudio();
        this.player.enqueue(part.inlineData.data);
        if (this.endPhase === "awaiting_goodbye") this.endPhase = "goodbye_playing";
        if (!this.botTurnOpen) {
          this.botTurnOpen = true;
          this.clearThinking();
          this.h.onStatus("speaking");
        }
      }
    }

    if (sc.outputTranscription?.text) {
      this.turnLog.modelText(sc.outputTranscription.text);
      this.h.onTranscript({ kind: "priya_delta", text: sc.outputTranscription.text });
    }

    if (sc.generationComplete) this.turnLog.generationComplete();

    if (sc.turnComplete) {
      this.turnLog.turnComplete();
      this.botTurnOpen = false;
      this.h.onTranscript({ kind: "turn_complete" });
      // Only the turn that carried the goodbye audio ends the call; a turnComplete
      // that arrives before the goodbye (e.g. right after the tool call) does not.
      const hangUpAfterThis = this.endPhase === "goodbye_playing";
      void this.player.whenDrained().then(() => {
        if (this.stopped) return;
        if (hangUpAfterThis && this.endPhase === "goodbye_playing") {
          this.h.onCallShouldEnd();
        } else if (!this.botTurnOpen) {
          this.h.onStatus("listening");
        }
      });
    }
  }

  private handleToolCall(msg: LiveServerMessage): void {
    this.clearThinking();
    // Words after a tool call are a new thought: start a new bubble.
    this.h.onTranscript({ kind: "priya_break" });
    this.h.onStatus("thinking");
    // Local context copy so several calls in one batch see each other's effects.
    let ctx = this.h.getContext();
    const functionResponses = (msg.toolCall?.functionCalls ?? []).map((fc) => {
      const id = fc.id ?? `${fc.name}_${Date.now()}`;
      const started = Date.now();
      const args = (fc.args as Record<string, unknown>) ?? {};
      this.h.onToolTrace({ id, name: fc.name ?? "unknown", args, status: "running", started_at: started });

      const exec = executeTool(fc.name, args, ctx);
      for (const ev of exec.events) ctx = applyEventToContext(ctx, ev);
      if (exec.events.length) this.h.onUiEvents(exec.events);
      if (exec.events.some((e) => e.type === "summary_ready")) this.armEndOfCall();

      this.h.onToolTrace({
        id,
        name: fc.name ?? "unknown",
        args,
        status: traceStatus(exec.response),
        result_line: exec.resultLine,
        started_at: started,
        duration_ms: Date.now() - started,
      });
      const status = traceStatus(exec.response);
      this.turnLog.tool(fc.name ?? "unknown", status, status === "blocked" ? String(exec.response.reason ?? "") : exec.resultLine);
      // Plain BLOCKING response with default scheduling, refusals included:
      // the model reads it and carries on (or waits for the seller) by itself.
      return { id: fc.id, name: fc.name, response: exec.response };
    });
    this.turnLog.note(`sent ${functionResponses.length} tool response(s)`);
    this.session?.sendToolResponse({ functionResponses });
  }

  /** After end_call_summary, hang up once Priya's goodbye has finished playing. */
  private armEndOfCall(): void {
    this.endPhase = "awaiting_goodbye";
    this.endArmedAt = Date.now();
    if (this.endSafetyTimer) clearTimeout(this.endSafetyTimer);
    // Safety net if the goodbye never comes; waits for any audio still playing.
    this.endSafetyTimer = setTimeout(() => {
      if (this.stopped || this.endPhase === "idle") return;
      void this.player.whenDrained().then(() => {
        if (!this.stopped && this.endPhase !== "idle") this.h.onCallShouldEnd();
      });
    }, END_CALL_SAFETY_MS);
  }

  private disarmEndOfCall(): void {
    this.endPhase = "idle";
    if (this.endSafetyTimer) clearTimeout(this.endSafetyTimer);
    this.endSafetyTimer = null;
  }

  private scheduleThinking(): void {
    this.clearThinking();
    this.thinkingTimer = setTimeout(() => {
      if (!this.player.isPlaying && !this.stopped) this.h.onStatus("thinking");
    }, THINKING_DELAY_MS);
  }

  private clearThinking(): void {
    if (this.thinkingTimer) clearTimeout(this.thinkingTimer);
    this.thinkingTimer = null;
  }

  private teardown(): void {
    this.stopped = true;
    this.clearThinking();
    this.cancelGreetFallback();
    if (this.endSafetyTimer) clearTimeout(this.endSafetyTimer);
    try {
      this.session?.close();
    } catch {
      /* ignore */
    }
    this.session = null;
    this.capture.stop();
    this.player.stop();
  }
}
