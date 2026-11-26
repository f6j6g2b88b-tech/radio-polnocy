export type AirStatus = "idle" | "opening" | "playing" | "blocked" | "lost";
export type StreamVolumeControl = "app" | "device";

type HlsClass = typeof import("hls.js").default;
type AirOptions = {
  createAudio?: () => HTMLAudioElement;
  loadHls?: () => Promise<HlsClass>;
  now?: () => number;
};

// A valid, short PCM file. Unlock the SAME element that will play the station.
const SILENT_WAV =
  "data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

const bounded = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Stream playback, including browsers that cannot route live HLS through Web Audio. */
export class Air {
  status: AirStatus = "idle";
  volumeControl: StreamVolumeControl = "app";
  readonly output: GainNode;
  private audio: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private hls: { destroy: () => void } | null = null;
  private url: string | null = null;
  private token = 0;
  private retryAt = 0;
  private quiet = true;
  private primed = false;
  private routed = false;
  private levelTarget = 0;
  private receiverGain = 1;

  constructor(
    private ctx: AudioContext,
    private emit: (status: AirStatus) => void,
    private options: AirOptions = {},
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = 0;
  }

  sync(url: string | null, level: number, receiverGain: number) {
    level = bounded(level);
    this.receiverGain = bounded(receiverGain);
    if (Math.abs(level - this.levelTarget) > 0.001) {
      this.levelTarget = level;
      this.output.gain.setTargetAtTime(level, this.ctx.currentTime, 0.04);
    }
    if (!url) {
      if (this.url || this.status !== "idle") this.stop();
      return;
    }
    this.applyVolume();
    if (this.url === url) {
      // A gesture, not another network retry, is required after NotAllowedError.
      if (this.status !== "lost" || this.now() < this.retryAt) return;
    }
    void this.open(url);
  }

  /** Call directly from a click/tap, before awaiting anything. */
  unlock() {
    const audio = this.element();
    const token = this.token;
    if (this.url) {
      if (this.status !== "blocked") return;
      this.setStatus("opening");
      void audio.play().catch((error: unknown) => {
        if (token === this.token) this.fail(error);
      });
      return;
    }
    if (this.primed) return;
    this.primed = true;
    audio.src = SILENT_WAV;
    void audio.play().then(
      () => {
        // A station may have replaced the primer while play() was pending.
        if (token === this.token && !this.url) audio.pause();
      },
      () => {
        if (token === this.token) this.primed = false;
      },
    );
  }

  stop() {
    this.token += 1;
    this.url = null;
    this.retryAt = 0;
    this.detach();
    this.setStatus("idle");
  }

  dispose() {
    this.stop();
    this.source?.disconnect();
    this.output.disconnect();
  }

  private now() {
    return this.options.now?.() ?? performance.now();
  }

  private element() {
    if (this.audio) return this.audio;
    const audio = this.options.createAudio?.() ?? new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "none";
    audio.setAttribute("playsinline", "");
    audio.addEventListener("playing", () => {
      if (!this.quiet && this.url) this.setStatus("playing");
    });
    audio.addEventListener("error", () => {
      if (!this.quiet && this.url) this.fail();
    });
    this.audio = audio;
    return audio;
  }

  private applyVolume() {
    if (!this.audio) return;
    const level = this.levelTarget * this.receiverGain;
    // muted works even on iOS where setting element.volume is ignored.
    this.audio.muted = level === 0;
    this.audio.volume = this.routed ? 1 : bounded(level);
  }

  private prepareOutput(nativeHls: boolean) {
    const audio = this.element();
    if (!nativeHls && !this.source) {
      try {
        this.source = this.ctx.createMediaElementSource(audio);
        this.source.connect(this.output);
        this.routed = true;
      } catch {
        this.routed = false;
      }
    }
    // Native HLS in WebKit can bypass a successfully constructed Web Audio
    // source (WebKit #180696). Use element volume there; report device control
    // when the browser does not support setting it, rather than a fake knob.
    if (!this.routed) {
      audio.volume = 0.5;
      this.volumeControl = Math.abs(audio.volume - 0.5) < 0.01 ? "app" : "device";
    } else {
      this.volumeControl = "app";
    }
    this.applyVolume();
  }

  private async open(url: string) {
    const token = ++this.token;
    this.detach();
    this.url = url;
    const audio = this.element();
    const playlist = url.includes(".m3u8");
    const nativeHls = playlist && audio.canPlayType("application/vnd.apple.mpegurl") !== "";
    this.prepareOutput(nativeHls);
    this.setStatus("opening");
    try {
      if (playlist && !nativeHls) {
        const Hls = await (this.options.loadHls?.() ?? import("hls.js").then((m) => m.default));
        if (token !== this.token) return;
        if (!Hls.isSupported()) {
          this.fail();
          return;
        }
        const hls = new Hls({ maxBufferLength: 12 });
        this.hls = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (token === this.token && !this.quiet && data.fatal) this.fail();
        });
        hls.loadSource(url);
        hls.attachMedia(audio);
      } else {
        audio.src = url;
      }
      if (token !== this.token) return;
      this.quiet = false;
      await audio.play();
    } catch (error) {
      if (token === this.token) this.fail(error);
    }
  }

  private fail(error?: unknown) {
    if (!this.url) return;
    const blocked = error instanceof Error && error.name === "NotAllowedError";
    this.retryAt = this.now() + 8000;
    this.setStatus(blocked ? "blocked" : "lost");
  }

  private detach() {
    this.quiet = true;
    this.hls?.destroy();
    this.hls = null;
    if (!this.audio) return;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  private setStatus(status: AirStatus) {
    if (this.status === status) return;
    this.status = status;
    this.emit(status);
  }
}
