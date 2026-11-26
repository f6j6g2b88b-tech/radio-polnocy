import assert from "node:assert/strict";
import test from "node:test";
import { Air, type AirStatus } from "./air.ts";

class FakeAudio extends EventTarget {
  src = "";
  crossOrigin = "";
  preload = "";
  muted = false;
  volume = 1;
  native = false;
  plays = 0;
  pauses = 0;
  playError: Error | null = null;
  nextPlay: Promise<void> | null = null;
  setAttribute() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {}
  canPlayType() {
    return this.native ? "probably" : "";
  }
  pause() {
    this.pauses += 1;
  }
  play(): Promise<void> {
    this.plays += 1;
    if (this.playError) return Promise.reject(this.playError);
    const pending = this.nextPlay;
    this.nextPlay = null;
    if (pending) return pending;
    this.dispatchEvent(new Event("playing"));
    return Promise.resolve();
  }
}

function setup({ native = false, graphFails = false, deviceVolume = false } = {}) {
  const audio = new FakeAudio();
  audio.native = native;
  if (deviceVolume) Object.defineProperty(audio, "volume", { get: () => 1, set: () => {} });
  let elements = 0;
  let disconnected = 0;
  let now = 0;
  const states: AirStatus[] = [];
  const output = {
    gain: { value: 0, setTargetAtTime() {} },
    disconnect() {
      disconnected += 1;
    },
  };
  const ctx = {
    currentTime: 0,
    createGain: () => output,
    createMediaElementSource: () => {
      if (graphFails) throw new Error("Media graph unavailable");
      return {
        connect() {},
        disconnect() {
          disconnected += 1;
        },
      };
    },
  } as unknown as AudioContext;
  const options = {
    createAudio: () => {
      elements += 1;
      return audio as unknown as HTMLAudioElement;
    },
    now: () => now,
  };
  const air = new Air(ctx, (status) => states.push(status), options);
  return {
    air,
    audio,
    states,
    ctx,
    options,
    elements: () => elements,
    disconnected: () => disconnected,
    advance: () => {
      now += 20_000;
    },
  };
}

test("unlock reuses the station element and a late primer cannot pause playback", async () => {
  const { air, audio, elements } = setup({ native: true });
  let finishPrimer!: () => void;
  audio.nextPlay = new Promise<void>((resolve) => {
    finishPrimer = resolve;
  });
  air.unlock();
  const primer = audio.src;
  const pcm = Buffer.from(primer.split(",")[1], "base64");
  assert.ok(pcm.length > 44, "primer must contain audio frames");
  air.sync("https://example.test/radio.m3u8", 0.9, 0.5);
  const pauses = audio.pauses;
  finishPrimer();
  await Promise.resolve();
  assert.equal(elements(), 1);
  assert.equal(audio.src, "https://example.test/radio.m3u8");
  assert.equal(audio.pauses, pauses);
  assert.equal(air.status, "playing");
});

test("fallback volume follows the receiver gain, including a complete mute", () => {
  const { air, audio } = setup({ graphFails: true });
  const url = "https://example.test/radio.mp3";
  air.sync(url, 0.9, 1);
  assert.equal(audio.volume, 0.9);
  air.sync(url, 0.9, 0.25);
  assert.equal(audio.volume, 0.225);
  air.sync(url, 0.9, 0);
  assert.equal(audio.volume, 0);
  assert.equal(audio.muted, true);
  air.sync(url, 0.9, 1);
  assert.equal(audio.muted, false);
});

test("native HLS uses supported element volume instead of an unreliable media graph", () => {
  const { air, audio } = setup({ native: true });
  air.sync("https://example.test/radio.m3u8", 0.8, 0.25);
  assert.equal(audio.volume, 0.2);
  assert.equal(air.volumeControl, "app");
});

test("device-only volume is reported honestly and zero still mutes the stream", () => {
  const { air, audio } = setup({ native: true, deviceVolume: true });
  const url = "https://example.test/radio.m3u8";
  air.sync(url, 0.9, 0.25);
  assert.equal(air.volumeControl, "device");
  air.sync(url, 0.9, 0);
  assert.equal(audio.muted, true);
});

test("blocked autoplay waits for a gesture and resumes the existing element", async () => {
  const { air, audio, advance, elements } = setup({ native: true });
  audio.playError = new DOMException("Tap required", "NotAllowedError");
  const url = "https://example.test/radio.m3u8";
  air.sync(url, 1, 1);
  await Promise.resolve();
  assert.equal(air.status, "blocked");
  const plays = audio.plays;
  advance();
  air.sync(url, 1, 1);
  assert.equal(audio.plays, plays, "do not treat denied autoplay as a network retry");
  audio.playError = null;
  air.unlock();
  assert.equal(elements(), 1);
  assert.equal(air.status, "playing");
});

test("turning off while HLS loads cannot restart a stopped station", async () => {
  const state = setup();
  let finishLoad!: (value: typeof import("hls.js").default) => void;
  const loaded = new Promise<typeof import("hls.js").default>((resolve) => {
    finishLoad = resolve;
  });
  const air = new Air(state.ctx, () => {}, { ...state.options, loadHls: () => loaded });
  air.sync("https://example.test/radio.m3u8", 1, 1);
  air.stop();
  let constructed = false;
  const Hls = class {
    constructor() {
      constructed = true;
    }
  };
  finishLoad(Hls as unknown as typeof import("hls.js").default);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(constructed, false);
  assert.equal(state.audio.plays, 0);
  assert.equal(air.status, "idle");
});

test("disposing releases the media source and stops playback", () => {
  const { air, audio, disconnected } = setup();
  air.sync("https://example.test/radio.mp3", 1, 1);
  air.dispose();
  assert.equal(audio.src, "");
  assert.equal(disconnected(), 2);
  assert.equal(air.status, "idle");
});
