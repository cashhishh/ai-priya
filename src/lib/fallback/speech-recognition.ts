/**
 * Thin, typed wrapper around the Web Speech API SpeechRecognition (Chrome/Edge).
 * - lang en-IN handles Indian English and romanised Hinglish well
 * - auto-restarts when Chrome stops after silence (unless paused)
 * - paused while Priya speaks so it doesn't transcribe her
 */

// Minimal typings: SpeechRecognition isn't in TypeScript's DOM lib everywhere.
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SRResultList { length: number; [index: number]: SRResult }
interface SREvent extends Event { resultIndex: number; results: SRResultList }
interface SRErrorEvent extends Event { error: string }
interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SRConstructor = new () => SR;

function getCtor(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export interface RecognizerHandlers {
  onInterim(text: string): void;
  onFinal(text: string): void;
  onFatalError(kind: "mic_denied" | "network" | "unknown", message: string): void;
}

export class Recognizer {
  private rec: SR | null = null;
  private wanted = false; // should we be listening right now?
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private rapidFailures = 0;

  constructor(private readonly handlers: RecognizerHandlers, private readonly lang = "en-IN") {}

  /** Start (or resume) listening. Safe to call repeatedly. */
  resume(): void {
    this.wanted = true;
    this.ensureRunning();
  }

  /** Stop listening, e.g. while Priya speaks or while we wait for the model. */
  pause(): void {
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.rec && this.running) {
      try {
        this.rec.abort();
      } catch {
        /* already stopped */
      }
    }
  }

  dispose(): void {
    this.pause();
    if (this.rec) {
      this.rec.onresult = this.rec.onerror = this.rec.onend = this.rec.onstart = null;
    }
    this.rec = null;
  }

  private create(): SR {
    const Ctor = getCtor();
    if (!Ctor) throw new Error("SpeechRecognition not supported");
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.running = true;
    };
    rec.onresult = (e) => {
      this.rapidFailures = 0;
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) {
          if (text.trim()) this.handlers.onFinal(text.trim());
        } else {
          interim += text;
        }
      }
      if (interim.trim()) this.handlers.onInterim(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.wanted = false;
        this.handlers.onFatalError("mic_denied", "Microphone access was blocked. Allow the mic in the address bar and try again.");
      } else if (e.error === "network") {
        this.rapidFailures++;
        if (this.rapidFailures > 3) {
          this.wanted = false;
          this.handlers.onFatalError("network", "Browser speech recognition lost its network connection. Check your internet and try again.");
        }
      }
      // "no-speech" and "aborted" are normal; onend handles the restart.
    };
    rec.onend = () => {
      this.running = false;
      // Chrome ends recognition after a stretch of silence: restart if we still want to listen.
      if (this.wanted) {
        this.restartTimer = setTimeout(() => this.ensureRunning(), 150 + this.rapidFailures * 400);
      }
    };
    return rec;
  }

  private ensureRunning(): void {
    if (!this.wanted || this.running) return;
    try {
      this.rec ??= this.create();
      this.rec.start();
      this.running = true;
    } catch {
      // start() throws if already started; onend will retry.
    }
  }
}
