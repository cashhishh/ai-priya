/**
 * Microphone capture for Live mode: getUserMedia → AudioWorklet (public/pcm-capture-worklet.js)
 * → 16 kHz PCM16 chunks (base64) delivered to `onChunk`.
 */
import { getMicStream } from "@/lib/voice/level-meter";
import { arrayBufferToBase64 } from "./pcm";

export class AudioCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private level = 0;
  private muted = false;

  constructor(private readonly onChunk: (base64Pcm: string, rms: number) => void) {}

  static isSupported(): boolean {
    return typeof window !== "undefined" && typeof AudioWorkletNode !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(): Promise<void> {
    this.stream = await getMicStream();
    this.ctx = new AudioContext();
    await this.ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture", { processorOptions: { targetRate: 16000 } });
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
      this.level = this.level * 0.5 + Math.min(1, e.data.rms * 6) * 0.5;
      if (!this.muted) this.onChunk(arrayBufferToBase64(e.data.pcm), e.data.rms);
    };
    // Worklet must be connected to be pulled; it outputs silence so nothing is heard.
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Pause sending (e.g. while reconnecting) without releasing the mic. */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  getLevel(): number {
    return this.level;
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.level = 0;
  }
}
