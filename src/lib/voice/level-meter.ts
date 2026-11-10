/** RMS level meter over an AnalyserNode, normalised to 0..1 for the visualiser. */
export class LevelMeter {
  private readonly buf: Float32Array<ArrayBuffer>;
  private smoothed = 0;

  constructor(private readonly analyser: AnalyserNode) {
    analyser.fftSize = 512;
    this.buf = new Float32Array(analyser.fftSize);
  }

  read(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    // Perceptual-ish scaling + light smoothing so bars don't flicker.
    const level = Math.min(1, rms * 6);
    this.smoothed = this.smoothed * 0.6 + level * 0.4;
    return this.smoothed;
  }
}

/** Browser-only mic stream with echo cancellation, which is essential for barge-in on speakers. */
export async function getMicStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access the microphone. Please use the latest Chrome or Edge.");
  }
  return navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}
