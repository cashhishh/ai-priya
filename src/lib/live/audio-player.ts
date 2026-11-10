/**
 * Gapless 24 kHz PCM playback for Live mode.
 *
 * Each incoming chunk becomes an AudioBufferSourceNode scheduled at
 * `nextStartTime`, so chunks butt up against each other with no gaps or
 * overlaps regardless of network jitter. `flush()` implements barge-in:
 * stop every scheduled source immediately and reset the clock.
 */
import { LevelMeter } from "@/lib/voice/level-meter";
import { base64Pcm16ToFloat32 } from "./pcm";

const OUTPUT_RATE = 24000;
/** Small safety lead so the first chunk never starts "in the past". */
const START_LEAD_S = 0.05;

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private meter: LevelMeter | null = null;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private drainListeners: (() => void)[] = [];

  async start(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE });
    this.gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser();
    this.gain.connect(analyser);
    analyser.connect(this.ctx.destination);
    this.meter = new LevelMeter(analyser);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  enqueue(base64Pcm: string): void {
    if (!this.ctx || !this.gain) return;
    const samples = base64Pcm16ToFloat32(base64Pcm);
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, OUTPUT_RATE);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);

    const now = this.ctx.currentTime;
    if (this.nextStartTime < now + 0.01) this.nextStartTime = now + START_LEAD_S;
    src.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;

    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (this.sources.size === 0) this.emitDrain();
    };
  }

  /** Barge-in: silence immediately and drop everything queued. */
  flush(): void {
    for (const src of this.sources) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.clear();
    this.nextStartTime = 0;
    this.emitDrain();
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  /** Resolves when everything queued has finished playing. */
  whenDrained(): Promise<void> {
    if (!this.isPlaying) return Promise.resolve();
    return new Promise((resolve) => this.drainListeners.push(resolve));
  }

  getLevel(): number {
    return this.meter && this.isPlaying ? this.meter.read() : 0;
  }

  stop(): void {
    this.flush();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private emitDrain(): void {
    const listeners = this.drainListeners;
    this.drainListeners = [];
    listeners.forEach((l) => l());
  }
}
