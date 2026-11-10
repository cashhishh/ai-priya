/**
 * speechSynthesis TTS that prefers an Indian voice and works around Chrome quirks:
 *  - long utterances get cut off after ~15s → we speak sentence by sentence
 *  - synthesis can silently pause → periodic resume() keep-alive
 *  - voices load asynchronously → wait for `voiceschanged`
 */

const DEVANAGARI = /[ऀ-ॿ]/;

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

async function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = window.speechSynthesis;
  const now = synth.getVoices();
  if (now.length) return now;
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1200);
  });
}

/** Score voices: Indian English (female/natural preferred), Hindi for Devanagari text. */
export function pickVoice(voices: SpeechSynthesisVoice[], devanagari: boolean): SpeechSynthesisVoice | null {
  const score = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase().replace("_", "-");
    const name = v.name.toLowerCase();
    let s = 0;
    if (devanagari) {
      if (lang.startsWith("hi")) s += 20;
      else if (lang === "en-in") s += 8;
    } else {
      if (lang === "en-in") s += 20;
      else if (lang.startsWith("hi")) s += 6;
      else if (lang.startsWith("en")) s += 2;
    }
    if (/neerja|heera|swara|kalpana|priya|veena|female|zira/.test(name)) s += 4;
    if (/natural|online|neural/.test(name)) s += 3;
    if (/google/.test(name)) s += 1;
    return s;
  };
  return [...voices].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?।]+[.!?।]*\s*/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

export class Speaker {
  private voices: SpeechSynthesisVoice[] = [];
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private cancelled = false;
  private speaking = false;
  /** Last word-boundary time, used to animate the bot visualiser. */
  private lastBoundary = 0;

  async init(): Promise<void> {
    this.voices = await loadVoices();
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  /** Synthetic 0..1 level while speaking (speechSynthesis exposes no audio). */
  level(): number {
    if (!this.speaking) return 0;
    const t = performance.now();
    const pulse = Math.max(0, 1 - (t - this.lastBoundary) / 220);
    return Math.min(1, 0.25 + 0.2 * Math.abs(Math.sin(t / 90)) + 0.45 * pulse);
  }

  /** Speak text sentence-by-sentence. Resolves when done or cancelled. */
  async speak(text: string): Promise<"done" | "cancelled"> {
    const synth = window.speechSynthesis;
    this.cancelled = false;
    this.speaking = true;
    synth.cancel();
    this.keepAlive = setInterval(() => {
      if (synth.speaking && !synth.paused) synth.resume();
    }, 5000);
    try {
      for (const sentence of splitSentences(text)) {
        if (this.cancelled) return "cancelled";
        await this.speakOne(sentence);
      }
      return this.cancelled ? "cancelled" : "done";
    } finally {
      this.speaking = false;
      if (this.keepAlive) clearInterval(this.keepAlive);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.speaking = false;
    if (isTtsSupported()) window.speechSynthesis.cancel();
  }

  private speakOne(sentence: string): Promise<void> {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(sentence);
      const voice = pickVoice(this.voices, DEVANAGARI.test(sentence));
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else {
        u.lang = "en-IN";
      }
      u.rate = 1.02;
      u.pitch = 1.05;
      u.onboundary = () => {
        this.lastBoundary = performance.now();
      };
      // Safety timeout: some voices never fire onend.
      const timeout = setTimeout(resolve, 2000 + sentence.length * 110);
      u.onend = u.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.lastBoundary = performance.now();
      window.speechSynthesis.speak(u);
    });
  }
}
