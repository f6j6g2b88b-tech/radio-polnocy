import type { VoiceId } from "@/lib/radio/stations";
import { Air, type AirStatus } from "./air";
export type { AirStatus } from "./air";

export type Mix = {
  power: boolean;
  volume: number;
  strength: number;
  place: number;
  voice: VoiceId | null;
  stream: string | null;
};

type Samples = { white: AudioBuffer; brown: AudioBuffer };

type Rig = {
  out: GainNode;
  tick: (time: number) => void;
  dispose: () => void;
  dead: boolean;
};

const globalRadio = globalThis as typeof globalThis & { __nightRadio?: Engine };

function makeNoise(ctx: AudioContext, kind: "white" | "brown") {
  const len = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === "white") {
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02;
    data[i] = last;
  }
  let peak = 0.0001;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
  const gain = 0.9 / peak;
  for (let i = 0; i < len; i++) data[i] *= gain;
  return buffer;
}

function ramp(param: AudioParam, value: number, time: number, tc = 0.05) {
  param.setTargetAtTime(value, time, tc);
}

function blip(
  ctx: AudioContext,
  dest: AudioNode,
  when: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + Math.min(0.04, dur * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(when);
  osc.stop(when + dur + 0.04);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

function puff(
  ctx: AudioContext,
  dest: AudioNode,
  buffer: AudioBuffer,
  when: number,
  dur: number,
  peak: number,
) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  source.start(when);
  source.stop(when + dur + 0.03);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}

class RigBuilder {
  readonly out: GainNode;
  dead = false;
  tick: (time: number) => void = () => {};
  private oscs: OscillatorNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private extra: AudioNode[] = [];

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
  }

  osc(type: OscillatorType, freq: number) {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.start();
    this.oscs.push(osc);
    return osc;
  }

  noise(buffer: AudioBuffer) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    this.sources.push(source);
    return source;
  }

  keep<T extends AudioNode>(node: T) {
    this.extra.push(node);
    return node;
  }

  dispose() {
    this.dead = true;
    for (const osc of this.oscs) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    for (const node of [...this.oscs, ...this.sources, ...this.extra, this.out]) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
  }
}

function wire(node: AudioNode, next: AudioNode) {
  node.connect(next);
  return next;
}

function createVoice(ctx: AudioContext, dest: AudioNode, id: VoiceId, samples: Samples): Rig {
  const rig = new RigBuilder(ctx, dest);

  switch (id) {
    case "lighthouse": {
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.2;
      wire(rig.osc("sine", 98), gain);
      wire(rig.osc("sine", 103.5), gain);
      gain.connect(rig.out);
      let next = 0;
      rig.tick = (time) => {
        if (rig.dead) return;
        if (next === 0) next = time + 1.1;
        if (next < time - 0.2) next = time + 0.1;
        if (time + 0.25 < next) return;
        blip(ctx, rig.out, next, 92, 1.55, 0.16);
        blip(ctx, rig.out, next + 0.04, 138, 1.2, 0.05);
        next += 8;
      };
      break;
    }
    case "train": {
      const filter = rig.keep(ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 240;
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.22;
      const lfo = rig.osc("sine", 2.15);
      const depth = rig.keep(ctx.createGain());
      depth.gain.value = 0.16;
      lfo.connect(depth);
      depth.connect(gain.gain);
      wire(wire(rig.noise(samples.brown), filter), gain).connect(rig.out);
      const rumble = rig.keep(ctx.createGain());
      rumble.gain.value = 0.08;
      wire(rig.osc("sine", 62), rumble);
      rumble.connect(rig.out);
      break;
    }
    case "library": {
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.045;
      wire(rig.osc("sine", 523.25), gain);
      wire(rig.osc("sine", 659.25), gain);
      gain.connect(rig.out);
      const trem = rig.osc("sine", 0.18);
      const tremDepth = rig.keep(ctx.createGain());
      tremDepth.gain.value = 0.02;
      trem.connect(tremDepth);
      tremDepth.connect(gain.gain);
      let next = 0;
      const waits = [4.8, 6.2, 5.1, 7.4];
      rig.tick = (time) => {
        if (rig.dead) return;
        if (next === 0) next = time + 1.6;
        if (next < time - 0.2) next = time + 0.2;
        if (time + 0.25 < next) return;
        puff(ctx, rig.out, samples.white, next, 0.18, 0.07);
        next += waits[Math.floor(next) % waits.length];
      };
      break;
    }
    case "kitchen": {
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.07;
      wire(rig.osc("triangle", 196), gain);
      wire(rig.osc("triangle", 294), gain);
      gain.connect(rig.out);
      let next = 0;
      let step = 0;
      const waits = [3.6, 4.8, 3.2, 5.4];
      rig.tick = (time) => {
        if (rig.dead) return;
        if (next === 0) next = time + 0.8;
        if (next < time - 0.2) next = time + 0.15;
        if (time + 0.25 < next) return;
        blip(ctx, rig.out, next, 1568, 0.22, 0.05);
        next += waits[step % waits.length];
        step += 1;
      };
      break;
    }
    case "observatory": {
      const osc = rig.osc("sine", 523.25);
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.09;
      osc.connect(gain);
      gain.connect(rig.out);
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33];
      let last = -1;
      rig.tick = (time) => {
        if (rig.dead) return;
        const index = Math.floor(time / 1.05) % notes.length;
        if (index === last) return;
        last = index;
        osc.frequency.setTargetAtTime(notes[index], time, 0.03);
      };
      break;
    }
    case "sea": {
      const filter = rig.keep(ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 380;
      const lfo = rig.osc("sine", 0.07);
      const depth = rig.keep(ctx.createGain());
      depth.gain.value = 190;
      lfo.connect(depth);
      depth.connect(filter.frequency);
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.55;
      wire(wire(rig.noise(samples.brown), filter), gain).connect(rig.out);
      break;
    }
    case "post": {
      const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
      const seq = [0, 2, 4, 2, 3, 1, 4, 0, 2, 5];
      const waits = [0.48, 0.42, 0.72, 0.36, 0.52, 0.9, 0.4, 0.62, 0.44, 1.15];
      let next = 0;
      let index = 0;
      rig.tick = (time) => {
        if (rig.dead) return;
        if (next === 0) next = time + 0.3;
        if (next < time - 0.05) next = time + 0.05;
        let guard = 0;
        while (next < time + 0.22 && guard++ < 8) {
          blip(ctx, rig.out, next, notes[seq[index % seq.length]], 0.55, 0.1);
          next += waits[index % waits.length];
          index += 1;
        }
      };
      break;
    }
    case "glass": {
      const low = rig.osc("sine", 392);
      const high = rig.osc("sine", 588);
      const vib = rig.osc("sine", 4.6);
      const depth = rig.keep(ctx.createGain());
      depth.gain.value = 4;
      vib.connect(depth);
      depth.connect(low.frequency);
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.06;
      low.connect(gain);
      const highGain = rig.keep(ctx.createGain());
      highGain.gain.value = 0.035;
      high.connect(highGain);
      gain.connect(rig.out);
      highGain.connect(rig.out);
      break;
    }
    case "dream": {
      const mix = rig.keep(ctx.createGain());
      mix.gain.value = 0.05;
      for (const freq of [220, 221.6, 277.2, 278.8, 329.6, 330.8]) {
        wire(rig.osc("sine", freq), mix);
      }
      const delay = rig.keep(ctx.createDelay(1));
      delay.delayTime.value = 0.27;
      const feedback = rig.keep(ctx.createGain());
      feedback.gain.value = 0.28;
      mix.connect(rig.out);
      mix.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(rig.out);
      break;
    }
    case "numbers": {
      const on = new Set([0, 1, 2, 4, 5, 6, 8, 9, 10, 14, 15]);
      const cycle = 20;
      let next = 0;
      let index = 0;
      rig.tick = (time) => {
        if (rig.dead) return;
        if (next === 0) next = time + 0.12;
        if (next < time - 0.05) next = time + 0.05;
        let guard = 0;
        while (next < time + 0.22 && guard++ < 8) {
          if (on.has(index % cycle)) blip(ctx, rig.out, next, 760, 0.09, 0.14);
          next += 0.125;
          index += 1;
        }
      };
      break;
    }
    case "cellar": {
      const hum = rig.keep(ctx.createGain());
      hum.gain.value = 0.14;
      wire(rig.osc("sine", 50), hum);
      hum.connect(rig.out);
      const octave = rig.keep(ctx.createGain());
      octave.gain.value = 0.05;
      wire(rig.osc("sine", 100), octave);
      octave.connect(rig.out);
      const filter = rig.keep(ctx.createBiquadFilter());
      filter.type = "bandpass";
      filter.frequency.value = 1040;
      filter.Q.value = 8;
      const hiss = rig.keep(ctx.createGain());
      hiss.gain.value = 0.03;
      wire(wire(rig.noise(samples.white), filter), hiss).connect(rig.out);
      break;
    }
    case "harbor": {
      const filter = rig.keep(ctx.createBiquadFilter());
      filter.type = "lowpass";
      filter.frequency.value = 280;
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.28;
      wire(wire(rig.noise(samples.brown), filter), gain).connect(rig.out);
      const keel = rig.keep(ctx.createGain());
      keel.gain.value = 0.07;
      wire(rig.osc("triangle", 130), keel);
      keel.connect(rig.out);
      let next = 0;
      rig.tick = (time) => {
        if (rig.dead) return;
        if (next === 0) next = time + 1.4;
        if (next < time - 0.2) next = time + 0.2;
        if (time + 0.25 < next) return;
        blip(ctx, rig.out, next, 494, 1.15, 0.1);
        blip(ctx, rig.out, next + 0.02, 740, 0.8, 0.04);
        next += 5.6;
      };
      break;
    }
    case "broadcast": {
      const gain = rig.keep(ctx.createGain());
      gain.gain.value = 0.03;
      wire(rig.osc("sine", 220), gain);
      gain.connect(rig.out);
      break;
    }
    default:
      return assertNever(id);
  }

  return rig;
}

function assertNever(value: never): never {
  throw new Error(`Nieznany głos: ${String(value)}`);
}

class Engine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private noiseGain: GainNode;
  private noiseFilter: BiquadFilterNode;
  private het: OscillatorNode;
  private hetGain: GainNode;
  private stationGain: GainNode;
  private samples: Samples;
  private voice: Rig | null = null;
  private voiceId: VoiceId | null = null;
  private params: Mix = {
    power: false,
    volume: 0.78,
    strength: 0,
    place: 0.2,
    voice: null,
    stream: null,
  };
  private raf = 0;
  private onVis: (() => void) | null = null;
  private airListeners = new Set<(status: AirStatus) => void>();
  private air: Air;
  private voiceBus: GainNode;
  private netHot = false;
  private mouths = new Map<string, { src: MediaStreamAudioSourceNode; gain: GainNode }>();
  private masterTarget = -1;

  constructor() {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 16;
    comp.ratio.value = 2.2;
    comp.attack.value = 0.01;
    comp.release.value = 0.24;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.stationGain = ctx.createGain();
    this.stationGain.connect(this.master);

    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.value = 1;
    this.voiceBus.connect(this.master);

    this.samples = {
      white: makeNoise(ctx, "white"),
      brown: makeNoise(ctx, "brown"),
    };

    const noise = ctx.createBufferSource();
    noise.buffer = this.samples.white;
    noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = "bandpass";
    this.noiseFilter.frequency.value = 1400;
    this.noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.2;
    noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    noise.start();

    this.het = ctx.createOscillator();
    this.het.type = "sine";
    this.het.frequency.value = 640;
    this.hetGain = ctx.createGain();
    this.hetGain.gain.value = 0;
    this.het.connect(this.hetGain);
    this.hetGain.connect(this.master);
    this.het.start();

    this.air = new Air(ctx, (status) => {
      for (const listener of this.airListeners) listener(status);
    });
    this.air.output.connect(this.master);

    this.onVis = () => {
      if (document.visibilityState === "visible") this.resume();
    };
    document.addEventListener("visibilitychange", this.onVis);
  }

  resume() {
    if (this.ctx.state !== "running") {
      void this.ctx.resume().catch(() => {
        /* A user gesture can resume a blocked context. */
      });
    }
  }

  unlockPlayback() {
    this.resume();
    this.air.unlock();
  }

  get streamVolumeControl() {
    return this.air.volumeControl;
  }

  onAir(listener: (status: AirStatus) => void) {
    this.airListeners.add(listener);
    listener(this.air.status);
    return () => {
      this.airListeners.delete(listener);
    };
  }

  sync(params: Mix) {
    this.params = params;
    this.apply(this.ctx.currentTime);
    this.kick();
  }

  /** `hot` ducks the station. `hear` is false while this set is transmitting. */
  setNet(hot: boolean, hear: boolean) {
    this.netHot = hot;
    ramp(this.voiceBus.gain, hear ? 1 : 0, this.ctx.currentTime, 0.03);
    this.kick();
  }

  attachMouth(id: string, stream: MediaStream) {
    this.detachMouth(id);
    const src = this.ctx.createMediaStreamSource(stream);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.65;
    const gain = this.ctx.createGain();
    gain.gain.value = 1.6;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.voiceBus);
    this.mouths.set(id, { src, gain });
    this.kick();
  }

  detachMouth(id: string) {
    const node = this.mouths.get(id);
    if (!node) return;
    node.src.disconnect();
    node.gain.disconnect();
    this.mouths.delete(id);
  }

  disposeAll() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.retire(this.voice);
    this.voice = null;
    for (const id of [...this.mouths.keys()]) this.detachMouth(id);
    this.air.dispose();
    if (this.onVis) document.removeEventListener("visibilitychange", this.onVis);
    void this.ctx.close();
  }

  private kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = () => {
    const time = this.ctx.currentTime;
    this.voice?.tick(time);
    this.apply(time);
    if (this.params.power || this.voice || this.mouths.size > 0)
      this.raf = requestAnimationFrame(this.loop);
    else this.raf = 0;
  };

  private apply(time: number) {
    this.ensureVoice();
    const live =
      !!this.params.stream && this.params.strength > 0.62 && this.air.status === "playing";
    if (!this.params.power) {
      if (this.masterTarget !== 0) {
        this.masterTarget = 0;
        ramp(this.master.gain, 0, time, 0.05);
      }
      this.air.sync(null, 0, 0);
      return;
    }
    const strength = this.params.strength;
    const level = this.params.volume * this.params.volume;
    if (Math.abs(level - this.masterTarget) > 0.001) {
      this.masterTarget = level;
      ramp(this.master.gain, level, time, 0.04);
    }
    const noiseOpen = live ? 0.012 : 0.08 + 0.5 * (1 - Math.pow(strength, 0.8));
    const noise = this.netHot ? Math.min(noiseOpen, 0.025) : noiseOpen;
    ramp(this.noiseGain.gain, noise, time, 0.08);
    const drift = Math.sin(time * 0.55) * 160;
    ramp(this.noiseFilter.frequency, 700 + this.params.place * 2200 + drift, time, 0.12);
    ramp(this.noiseFilter.Q, 0.55 + strength * 6.5, time, 0.1);
    const hetAmt =
      live || this.netHot
        ? 0
        : strength > 0.03 && strength < 0.92
          ? Math.sin((strength / 0.92) * Math.PI)
          : 0;
    ramp(this.hetGain.gain, hetAmt * 0.09, time, 0.05);
    ramp(this.het.frequency, Math.max(80, 180 + (1 - strength) * 1700), time, 0.06);
    if (this.voice)
      ramp(this.voice.out.gain, live || this.netHot ? 0.04 : Math.pow(strength, 1.15), time, 0.07);
    const feed = this.params.stream && strength > 0.62 ? this.params.stream : null;
    this.air.sync(feed, feed ? 0.9 * Math.pow(Math.max(strength, 0.001), 0.8) : 0, level);
  }

  private ensureVoice() {
    const want =
      this.params.power && this.params.voice && this.params.strength > 0.05
        ? this.params.voice
        : null;
    if (want === this.voiceId) return;
    this.retire(this.voice);
    this.voice = null;
    this.voiceId = want;
    if (!want) return;
    this.voice = createVoice(this.ctx, this.stationGain, want, this.samples);
  }

  private retire(voice: Rig | null) {
    if (!voice) return;
    voice.dead = true;
    voice.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    window.setTimeout(() => voice.dispose(), 280);
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    globalRadio.__nightRadio?.disposeAll();
    globalRadio.__nightRadio = undefined;
  });
}

export function peekEngine() {
  return globalRadio.__nightRadio ?? null;
}

export function getEngine() {
  if (globalRadio.__nightRadio) {
    globalRadio.__nightRadio.unlockPlayback();
    return globalRadio.__nightRadio;
  }
  try {
    const engine = new Engine();
    globalRadio.__nightRadio = engine;
    engine.unlockPlayback();
    return engine;
  } catch {
    return null;
  }
}
