import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ShortwaveNet, normalizeSign } from "@/components/radio/shortwave-net";
import { getEngine, peekEngine, type AirStatus, type Mix } from "@/lib/radio/audio";
import { STATIONS, rdsFor, stationById, type BandId } from "@/lib/radio/stations";
import {
  BANDS,
  clamp01,
  clampFreq,
  describe,
  dialPercent,
  formatFreq,
  phaseOf,
  scaleTicks,
  signalWord,
  type Phase,
} from "@/lib/radio/tuning";

const STORAGE_KEY = "radio-polnocy-v1";

type Caught = { id: string; at: number };

type Memory = {
  band: BandId;
  fm: number;
  sw: number;
  pl: number;
  volume: number;
  caught: Caught[];
  sign: string;
};

const INITIAL: Memory = {
  band: "fm",
  fm: 90,
  sw: 6000,
  pl: 94,
  volume: 0.78,
  caught: [],
  sign: "",
};

function sanitize(raw: unknown): Memory {
  if (!raw || typeof raw !== "object") return INITIAL;
  const record = raw as Partial<Memory>;
  const band: BandId = record.band === "sw" || record.band === "pl" ? record.band : "fm";
  const fm = clampFreq("fm", typeof record.fm === "number" ? record.fm : INITIAL.fm);
  const sw = clampFreq("sw", typeof record.sw === "number" ? record.sw : INITIAL.sw);
  const pl = clampFreq("pl", typeof record.pl === "number" ? record.pl : INITIAL.pl);
  const volume = clamp01(typeof record.volume === "number" ? record.volume : INITIAL.volume);
  const caught = Array.isArray(record.caught)
    ? record.caught
        .filter((item): item is Caught => {
          if (!item || typeof item !== "object") return false;
          const entry = item as Partial<Caught>;
          return typeof entry.id === "string" && typeof entry.at === "number" && !!stationById(entry.id);
        })
        .slice(0, 24)
    : [];
  const sign = normalizeSign(typeof record.sign === "string" ? record.sign : "");
  return { band, fm, sw, pl, volume, caught, sign };
}

function mixFrom(power: boolean, memory: Memory): Mix {
  const tuned = describe(memory.band, memory[memory.band]);
  return {
    power,
    volume: memory.volume,
    strength: power ? tuned.strength : 0,
    place: tuned.place,
    voice: power && tuned.strength > 0.05 ? tuned.station.voice : null,
    stream: power && tuned.station.stream && tuned.strength > 0.62 ? tuned.station.stream : null,
  };
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return reduced;
}

const GLYPHS = "░▒▓";

function corrupt(text: string, amount: number, seed: number) {
  if (amount <= 0.02) return text;
  let state = seed || 1;
  let out = "";
  for (const char of text) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const roll = (state % 1000) / 1000;
    if (char.trim() && char !== "\n" && roll < amount) out += GLYPHS[state % GLYPHS.length];
    else out += char;
  }
  return out;
}

function clock(at: number) {
  return new Date(at).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
}

export function RadioApp() {
  const [memory, setMemory] = useState<Memory>(INITIAL);
  const [hydrated, setHydrated] = useState(false);
  const [on, setOn] = useState(false);
  const [deaf, setDeaf] = useState(false);
  const [audioState, setAudioState] = useState("off");
  const [scanning, setScanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [noted, setNoted] = useState("");
  const [count, setCount] = useState(0);
  const [seed, setSeed] = useState(1);
  const [air, setAir] = useState<AirStatus>("idle");
  const [netLive, setNetLive] = useState(false);
  const reduced = useReducedMotion();

  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const powerRef = useRef(on);
  powerRef.current = on;
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const drag = useRef<{ x: number; y: number; freq: number; pointer: number } | null>(null);
  const volDrag = useRef<{ y: number; volume: number; pointer: number } | null>(null);

  const freq = memory[memory.band];
  const tuned = useMemo(() => describe(memory.band, freq), [memory.band, freq]);
  const phase: Phase = phaseOf(on, tuned.strength);
  const word = signalWord(on, tuned.strength);
  const ticks = useMemo(() => scaleTicks(memory.band), [memory.band]);
  const bandStations = useMemo(
    () => STATIONS.filter((station) => station.band === memory.band),
    [memory.band],
  );
  const caughtIds = useMemo(() => new Set(memory.caught.map((item) => item.id)), [memory.caught]);
  const log = useMemo(
    () => [...memory.caught].sort((a, b) => b.at - a.at),
    [memory.caught],
  );

  function stopScan() {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
    setScanning((value) => (value ? false : value));
  }

  function setFreq(next: number) {
    stopScan();
    setMemory((current) => ({ ...current, [current.band]: clampFreq(current.band, next) }));
  }

  function turnOn() {
    const engine = getEngine();
    if (!engine) {
      setDeaf(true);
      setOn(true);
      setAudioState("unavailable");
      return;
    }
    setDeaf(false);
    engine.sync(mixFrom(true, memoryRef.current));
    setOn(true);
    setAudioState(engine.ctx.state);
  }

  function turnOff() {
    stopScan();
    peekEngine()?.sync(mixFrom(false, memoryRef.current));
    setOn(false);
    setAudioState("off");
  }

  function tuneTo(id: string) {
    const station = stationById(id);
    if (!station) return;
    stopScan();
    const next = { ...memoryRef.current, band: station.band, [station.band]: station.freq };
    setMemory(next);
    const engine = powerRef.current ? peekEngine() : getEngine();
    if (!engine) setDeaf(true);
    else {
      setDeaf(false);
      engine.sync(mixFrom(true, next));
      setAudioState(engine.ctx.state);
    }
    setOn(true);
  }

  function startScan() {
    if (!powerRef.current) return;
    if (scanTimer.current) {
      stopScan();
      return;
    }
    const band = memoryRef.current.band;
    const spec = BANDS[band];
    let cursor = memoryRef.current[band];
    let traveled = 0;
    let armed = false;
    const step = band === "sw" ? 28 : 0.07;
    const armDist = band === "sw" ? 70 : 0.16;
    setScanning(true);
    scanTimer.current = setInterval(() => {
      cursor = Math.min(spec.max, cursor + step);
      traveled += step;
      const hit = describe(band, cursor);
      if (!armed) {
        if (hit.strength < 0.4 && traveled >= armDist) armed = true;
      } else if (hit.strength >= 0.9) {
        cursor = hit.station.freq;
        setMemory((current) => ({ ...current, [band]: cursor }));
        stopScan();
        return;
      }
      if (cursor >= spec.max) {
        setMemory((current) => ({ ...current, [band]: spec.max }));
        stopScan();
        return;
      }
      setMemory((current) => ({ ...current, [band]: cursor }));
    }, 40);
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMemory(sanitize(JSON.parse(raw)));
    } catch {
      /* ignore broken storage */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
      } catch {
        /* ignore quota */
      }
    }, 180);
    return () => window.clearTimeout(id);
  }, [memory, hydrated]);

  useEffect(() => {
    const engine = peekEngine();
    if (!engine) return;
    engine.sync(mixFrom(on, memory));
  }, [on, memory]);

  useEffect(() => {
    if (!on) return;
    const engine = peekEngine();
    if (!engine) return;
    const pull = () => setAudioState(engine.ctx.state);
    pull();
    engine.ctx.addEventListener("statechange", pull);
    return () => engine.ctx.removeEventListener("statechange", pull);
  }, [on]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!powerRef.current) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const dir = event.key === "ArrowRight" ? 1 : -1;
        stopScan();
        setMemory((current) => {
          const spec = BANDS[current.band];
          const step = event.shiftKey ? spec.coarse : spec.fine;
          return { ...current, [current.band]: clampFreq(current.band, current[current.band] + dir * step) };
        });
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const dir = event.key === "ArrowUp" ? 1 : -1;
        setMemory((current) => ({ ...current, volume: clamp01(current.volume + dir * 0.04) }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (scanTimer.current) clearInterval(scanTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!on) {
      setAir("idle");
      return;
    }
    const engine = peekEngine();
    if (!engine) return;
    return engine.onAir(setAir);
  }, [on]);

  useEffect(() => {
    if (phase !== "lock") return;
    const id = tuned.station.id;
    const name = tuned.station.name;
    const known = memoryRef.current.caught.some((item) => item.id === id);
    const timer = window.setTimeout(() => {
      setMemory((current) =>
        current.caught.some((item) => item.id === id)
          ? current
          : { ...current, caught: [{ id, at: Date.now() }, ...current.caught].slice(0, 24) },
      );
      if (!known) setNoted(name);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [phase, tuned.station.id, tuned.station.name]);

  useEffect(() => {
    if (!noted) return;
    const timer = window.setTimeout(() => setNoted(""), 2600);
    return () => window.clearTimeout(timer);
  }, [noted]);

  const letter = tuned.station.lines.join("\n\n");

  useEffect(() => {
    if (phase !== "lock") {
      setCount(0);
      return;
    }
    if (reduced) {
      setCount(letter.length);
      return;
    }
    setCount(0);
    const total = letter.length;
    const timer = window.setInterval(() => {
      setCount((value) => {
        if (value >= total) {
          window.clearInterval(timer);
          return value;
        }
        return Math.min(total, value + 2);
      });
    }, 18);
    return () => window.clearInterval(timer);
  }, [phase, tuned.station.id, reduced, letter]);

  const corruptAmount = phase === "lock" ? Math.max(0, (0.93 - tuned.strength) * 2.2) : 0;

  useEffect(() => {
    if (reduced || corruptAmount <= 0.04) return;
    const timer = window.setInterval(() => setSeed((value) => (value + 17) % 997), 140);
    return () => window.clearInterval(timer);
  }, [reduced, corruptAmount > 0.04, tuned.station.id]);

  const shown = corrupt(letter.slice(0, count), corruptAmount, seed);
  const turn = -150 + tuned.place * 300;

  function onScaleDown(event: PointerEvent<HTMLDivElement>) {
    if (!on) return;
    event.preventDefault();
    stopScan();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already gone */
    }
    drag.current = { x: event.clientX, y: event.clientY, freq, pointer: event.pointerId };
    setDragging(true);
  }

  function onScaleMove(event: PointerEvent<HTMLDivElement>) {
    const session = drag.current;
    if (!session || event.pointerId !== session.pointer) return;
    const width = event.currentTarget.getBoundingClientRect().width || 1;
    const span = BANDS[memory.band].max - BANDS[memory.band].min;
    setFreq(session.freq + ((event.clientX - session.x) / width) * span);
  }

  function endDrag() {
    drag.current = null;
    setDragging(false);
  }

  function onKnobDown(event: PointerEvent<HTMLButtonElement>) {
    if (!on) return;
    event.preventDefault();
    stopScan();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already gone */
    }
    drag.current = { x: event.clientX, y: event.clientY, freq, pointer: event.pointerId };
    setDragging(true);
  }

  function onKnobMove(event: PointerEvent<HTMLButtonElement>) {
    const session = drag.current;
    if (!session || event.pointerId !== session.pointer) return;
    const span = BANDS[memory.band].max - BANDS[memory.band].min;
    setFreq(session.freq - ((event.clientY - session.y) / 320) * span);
  }

  const heading =
    phase === "off"
      ? "Odbiornik śpi"
      : phase === "static"
        ? "Cisza na paśmie"
        : tuned.station.name;
  const body =
    phase === "off"
      ? "Włącz go. Potem prowadź skalę albo gałkę, aż szum się rozstąpi i ktoś zacznie mówić."
      : phase === "static"
        ? memory.band === "pl"
          ? "Między antenami jest cisza. Na tej skali czekają Dwójka, Trójka, Czwórka, Radio 24, Dzieciom i Kierowców."
          : "Między stacjami jest tylko noc. Znaczki na skali to miejsca, w których ktoś czeka."
        : phase === "near"
          ? "Prawie. Jeszcze włos w lewo albo w prawo — głos jest tuż pod szumem."
          : shown;

  function endVolume() {
    volDrag.current = null;
  }

  function onVolumeDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* pointer already gone */
    }
    volDrag.current = { y: event.clientY, volume: memory.volume, pointer: event.pointerId };
  }

  function onVolumeMove(event: PointerEvent<HTMLButtonElement>) {
    const session = volDrag.current;
    if (!session || event.pointerId !== session.pointer) return;
    const next = clamp01(session.volume - (event.clientY - session.y) / 150);
    setMemory((current) => ({ ...current, volume: next }));
  }

  const eyeGap = on ? Math.max(10, 78 - (netLive ? 1 : tuned.strength) * 68) : 82;
  const eyeGlow = !on ? 0 : netLive || phase === "lock" ? 1 : tuned.strength * 0.55;

  return (
    <main
      className="relative min-h-dvh overflow-x-hidden"
      data-testid="radio"
      data-audio={on ? audioState : "off"}
      data-stream={air}
    >
      <div className="grain" aria-hidden="true" />
      <div className="halo" aria-hidden="true" />
      <div className="relative z-10 mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-6 sm:px-8 sm:py-10">
        <header>
          <p className="font-mono text-xs tracking-widest text-cream/70 uppercase">Odbiornik nocny</p>
          <h1 className="font-display text-4xl text-balance sm:text-5xl">Radio Północy</h1>
          <p className="mt-2 max-w-md text-pretty text-cream/75">
            Dwanaście stacji, których nie ma w programie. Na paśmie Polska — prawdziwe anteny.
          </p>
        </header>

        <section className="cabinet" aria-label="Odbiornik">
          <div className="px-4 pt-4 sm:px-5">
            <div className="cloth">
              <div
                className={netLive || phase === "lock" ? "eye is-lit" : on && tuned.strength > 0.4 ? "eye is-warm" : "eye"}
                style={{ ["--glow" as string]: String(eyeGlow), ["--gap" as string]: `${eyeGap}deg` }}
                data-testid="eye"
                data-lit={netLive || phase === "lock" ? "yes" : "no"}
                aria-hidden="true"
              >
                <span className="eye-glass" />
                <span className="eye-core" />
              </div>
            </div>
          </div>

          <div className="scale-frame">
            <div className="min-w-0 flex-1">
              <p
                className={
                  on
                    ? "nixie is-on flex items-baseline gap-2 font-mono text-2xl tabular-nums sm:text-3xl"
                    : "nixie flex items-baseline gap-2 font-mono text-2xl tabular-nums text-cream/40 sm:text-3xl"
                }
                data-testid="freq"
                data-freq={freq}
              >
                <span>{formatFreq(memory.band, freq)}</span>
                <span className="font-mono text-xs tracking-widest text-cream/60">{BANDS[memory.band].unit}</span>
              </p>
              <p className="truncate font-display text-lg text-cream/80">
                {!on ? "odbiornik śpi" : phase === "static" ? "między stacjami" : tuned.station.name}
              </p>
              <div
                className={
                  dragging
                    ? "tuner relative mt-2 h-16 cursor-grabbing"
                    : "tuner relative mt-2 h-16 cursor-grab"
                }
                role="slider"
                tabIndex={0}
                aria-label="Skala częstotliwości"
                aria-valuemin={BANDS[memory.band].min}
                aria-valuemax={BANDS[memory.band].max}
                aria-valuenow={Number(freq.toFixed(2))}
                aria-valuetext={`${formatFreq(memory.band, freq)} ${BANDS[memory.band].unit}, ${word}`}
                aria-disabled={!on}
                onPointerDown={onScaleDown}
                onPointerMove={onScaleMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
              >
                {ticks.map((tick) => (
                  <span
                    key={tick.freq}
                    className="pointer-events-none absolute top-0 bottom-0 flex -translate-x-1/2 flex-col items-center"
                    style={{ left: `${dialPercent(memory.band, tick.freq)}%` }}
                  >
                    <span className={tick.major ? "h-3 w-px bg-cream/70" : "h-2 w-px bg-cream/30"} />
                    {tick.label ? <span className="mt-auto font-mono text-[10px] text-cream/55">{tick.label}</span> : null}
                  </span>
                ))}
                {bandStations.map((station) => (
                  <span
                    key={station.id}
                    className={
                      caughtIds.has(station.id)
                        ? "pointer-events-none absolute top-4 size-1.5 -translate-x-1/2 rounded-full bg-cream"
                        : "pointer-events-none absolute top-4 size-1.5 -translate-x-1/2 rounded-full bg-cream/35"
                    }
                    style={{ left: `${dialPercent(memory.band, station.freq)}%` }}
                  />
                ))}
                <span className="pointer" style={{ left: `${dialPercent(memory.band, freq)}%` }} />
              </div>
              <RdsLine
                on={on}
                band={memory.band}
                phase={phase}
                stationId={tuned.station.id}
                strength={tuned.strength}
                seed={seed}
                reduced={reduced}
              />
            </div>
            <div role="radiogroup" aria-label="Zakres" className="flex flex-col justify-center gap-1.5">
              {(["fm", "sw", "pl"] as const).map((band) => (
                <button
                  key={band}
                  type="button"
                  role="radio"
                  aria-checked={memory.band === band}
                  aria-label={BANDS[band].label}
                  data-testid={band === "sw" ? "band-sw" : band === "pl" ? "band-pl" : "band-fm"}
                  className={memory.band === band ? "band-key tap is-on" : "band-key tap"}
                  onClick={() => {
                    stopScan();
                    setMemory((current) => ({ ...current, band }));
                  }}
                >
                  {band === "fm" ? "FM" : band === "sw" ? "KR" : "PL"}
                </button>
              ))}
            </div>
          </div>

          <div className="apron">
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                className="knob tap relative"
                style={{ transform: `rotate(${turn}deg)` }}
                aria-label="Gałka strojenia"
                aria-orientation="vertical"
                aria-valuemin={BANDS[memory.band].min}
                aria-valuemax={BANDS[memory.band].max}
                aria-valuenow={Number(freq.toFixed(2))}
                aria-valuetext={`${formatFreq(memory.band, freq)} ${BANDS[memory.band].unit}`}
                aria-disabled={!on}
                onPointerDown={onKnobDown}
                onPointerMove={onKnobMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
              >
                <span className="knob-mark" />
              </button>
              <span className="knob-label">Strojenie</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                data-testid="scan"
                className="knob knob-sm tap relative"
                disabled={!on}
                aria-pressed={scanning}
                aria-label={scanning ? "Zatrzymaj przeszukiwanie" : "Przeszukaj pasmo"}
                onClick={startScan}
              >
                <span className="knob-mark" />
              </button>
              <span className="knob-label">{scanning ? "Stop" : "Szukaj"}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={on ? "Wyłącz odbiornik" : "Włącz odbiornik"}
                data-testid="power"
                className={on ? "knob knob-sm tap relative is-on" : "knob knob-sm tap relative"}
                onClick={() => (on ? turnOff() : turnOn())}
              >
                <span className="knob-mark" />
              </button>
              <span className="knob-label">{on ? "Sieć" : "Wył."}</span>
            </div>
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                className="knob tap relative"
                style={{ transform: `rotate(${-130 + memory.volume * 260}deg)` }}
                aria-label="Głośność"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(memory.volume * 100)}
                aria-valuetext={`${Math.round(memory.volume * 100)} procent`}
                onPointerDown={onVolumeDown}
                onPointerMove={onVolumeMove}
                onPointerUp={endVolume}
                onPointerCancel={endVolume}
                onLostPointerCapture={endVolume}
              >
                <span className="knob-mark" />
              </button>
              <span className="knob-label">Głos</span>
            </div>
          </div>
          {deaf ? (
            <p className="px-4 pb-4 text-sm text-cream/80">Ta przeglądarka nie puszcza dźwięku. Kartka i tak się zapisze.</p>
          ) : null}
          {memory.band === "sw" ? (
            <ShortwaveNet
              on={on && !deaf}
              freq={freq}
              sign={memory.sign}
              onSign={(sign) => setMemory((current) => ({ ...current, sign }))}
              onLive={setNetLive}
            />
          ) : null}
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-2">
            <article className="paper px-5 py-5 sm:px-7 sm:py-6" data-testid="paper" aria-label="Depesza">
              <p className="font-mono text-xs tracking-widest uppercase">
                {phase === "off"
                  ? "Nasłuch · uśpiony"
                  : `Nasłuch · ${formatFreq(memory.band, freq)} ${BANDS[memory.band].unit} · ${word}`}
                {phase === "lock" ? ` · ${tuned.station.sign}` : ""}
              </p>
              <h2 className="mt-3 font-display text-3xl text-balance" data-testid="station">
                {heading}
              </h2>
              <p className="mt-4 text-pretty whitespace-pre-wrap leading-normal" aria-hidden={phase === "lock"}>
                {body}
                {phase === "lock" && count < letter.length && !reduced ? <span className="caret" /> : null}
              </p>
              {noted ? <p className="mt-4 font-display text-lg italic">Wpisane do dziennika — {noted}.</p> : null}
              {phase === "lock" && tuned.station.stream ? (
                <p className="mt-4 font-mono text-xs tracking-widest" data-testid="stream">
                  {air === "playing"
                    ? "Na żywo · strumień Polskiego Radia"
                    : air === "lost"
                      ? "Strumień nie doszedł. Zostaw skalę, spróbuję jeszcze raz."
                      : "Łączę ze strumieniem…"}
                </p>
              ) : null}
            </article>

            <section aria-label="Dziennik nasłuchu">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="font-display text-2xl">Dziennik nasłuchu</h2>
                <p className="font-mono text-xs tracking-widest text-cream/60 tabular-nums">
                  {memory.caught.length} z {STATIONS.length}
                </p>
              </div>
              {log.length === 0 ? (
                <p className="mt-3 text-cream/70">Dziennik jest pusty. Zostań na stacji chwilę, a sama się wpisze.</p>
              ) : (
                <ul className="mt-2 max-h-80 overflow-auto">
                  {log.map((item) => {
                    const station = stationById(item.id);
                    if (!station) return null;
                    return (
                      <li key={item.id} className="flex items-center gap-3 border-t border-cream/15 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-display text-lg">{station.name}</p>
                          <p className="font-mono text-xs text-cream/60 tabular-nums">
                            {formatFreq(station.band, station.freq)} {BANDS[station.band].unit} · {clock(item.at)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="tap h-11 shrink-0 rounded-full border border-cream/20 px-4 font-mono text-xs text-cream"
                          onClick={() => tuneTo(item.id)}
                        >
                          Dostrój
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

        <footer className="flex flex-col gap-1 pb-4">
          <p className="hidden font-mono text-xs text-cream/50 md:block">
            Strzałki stroją. Z Shiftem skok jest większy. W górę i w dół — głośność.
          </p>
          <p className="font-mono text-xs text-cream/50">Najlepiej w słuchawkach, przy zgaszonym świetle.</p>
        </footer>

        <p className="sr-only" aria-live="polite">
          {phase === "lock" ? `${tuned.station.name}. ${tuned.station.lines.join(" ")}` : phase === "near" ? `Blisko stacji ${tuned.station.name}.` : ""}
        </p>
      </div>
    </main>
  );
}

function RdsLine({
  on,
  band,
  phase,
  stationId,
  strength,
  seed,
  reduced,
}: {
  on: boolean;
  band: BandId;
  phase: Phase;
  stationId: string;
  strength: number;
  seed: number;
  reduced: boolean;
}) {
  const service = band === "sw" ? null : rdsFor(stationId);
  const noisy = phase !== "lock" || strength < 0.93;
  const amount = !on || !service ? 0 : phase === "lock" ? Math.max(0, (0.93 - strength) * 2.2) : 0.55;
  const ps = !on
    ? "--------"
    : !service
      ? "BEZ RDS"
      : corrupt(service.ps.padEnd(8, " ").slice(0, 8), amount, seed);
  const pty = service && on && phase !== "static" ? corrupt(service.pty, amount, seed + 5) : "";
  const text = !on
    ? ""
    : !service
      ? "Fale krótkie nie niosą tego systemu."
      : phase === "static"
        ? "Szukam nośnej…"
        : corrupt(service.text, amount, seed + 11);

  return (
    <div className={on && service && phase !== "static" ? "rds is-on" : "rds"} data-testid="rds" data-ps={service?.ps ?? ""}>
      <span className="rds-tag">RDS</span>
      <span className="rds-ps">{ps}</span>
      <span className="rds-pty">{pty}</span>
      <span className="rds-rt">
        {on && service && phase === "lock" && !noisy && !reduced ? (
          <span className="rds-scroll">
            {text} · {text}
          </span>
        ) : (
          text
        )}
      </span>
    </div>
  );
}
