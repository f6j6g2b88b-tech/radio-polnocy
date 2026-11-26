/** Plays received RTC audio through the radio's filters and volume controls. */
export class RemoteVoice {
  private readonly source: MediaStreamAudioSourceNode;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private readonly audio: HTMLAudioElement;
  private starting = false;
  private disposed = false;

  constructor(
    ctx: AudioContext,
    destination: AudioNode,
    stream: MediaStream,
    createAudio: () => HTMLAudioElement = () => new Audio(),
  ) {
    this.source = ctx.createMediaStreamSource(stream);
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "bandpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 0.65;
    this.gain = ctx.createGain();
    this.gain.gain.value = 1.6;
    this.source.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(destination);

    // Chromium needs a live media element to pull/decode received RTC audio,
    // even when Web Audio consumes the stream. Keep it muted so the graph
    // above remains the only audible path (including volume and TX muting).
    // https://issues.chromium.org/issues/40094084
    this.audio = createAudio();
    this.audio.muted = true;
    this.audio.autoplay = true;
    this.audio.setAttribute("playsinline", "");
    this.audio.srcObject = stream;
    this.resume();
  }

  resume() {
    if (this.disposed || this.starting || !this.audio.paused) return;
    this.starting = true;
    try {
      void this.audio.play().catch(() => {
        // A subsequent user gesture or visibility change retries playback.
      }).finally(() => {
        this.starting = false;
      });
    } catch {
      this.starting = false;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.autoplay = false;
    this.audio.pause();
    this.audio.srcObject = null;
    this.source.disconnect();
    this.filter.disconnect();
    this.gain.disconnect();
  }
}
