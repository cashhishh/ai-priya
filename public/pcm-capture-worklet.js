/**
 * AudioWorklet: mic Float32 @ context rate (usually 48 kHz)
 *            → mono PCM16 @ 16 kHz in ~40 ms chunks, posted to the main thread.
 *
 * Runs on the audio rendering thread, so capture never stutters even if the
 * UI thread is busy. Downsampling uses box-filter averaging (cheap low-pass)
 * which is plenty for speech.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = (options && options.processorOptions && options.processorOptions.targetRate) || 16000;
    this.ratio = sampleRate / this.targetRate; // e.g. 48000 / 16000 = 3
    this.chunkSize = Math.round(this.targetRate * 0.04); // 640 samples = 40 ms
    this.out = new Int16Array(this.chunkSize);
    this.outIndex = 0;
    this.acc = 0; // running sum of input samples for the current output sample
    this.accCount = 0;
    this.pos = 0; // fractional position for non-integer ratios (e.g. 44.1k)
    this.sumSquares = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const s = channel[i];
      this.acc += s;
      this.accCount++;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const avg = this.acc / this.accCount;
        this.acc = 0;
        this.accCount = 0;
        const clamped = Math.max(-1, Math.min(1, avg));
        this.out[this.outIndex++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        this.sumSquares += clamped * clamped;
        if (this.outIndex === this.chunkSize) {
          const rms = Math.sqrt(this.sumSquares / this.chunkSize);
          // Transfer the buffer (zero-copy) and start a fresh one.
          this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]);
          this.out = new Int16Array(this.chunkSize);
          this.outIndex = 0;
          this.sumSquares = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
