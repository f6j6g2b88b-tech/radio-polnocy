import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Volume2, VolumeX } from "lucide-react";
import { getEngine, peekEngine, type AirStatus, type Mix } from "@/lib/radio/audio";
import { STATIONS, stationById, type BandId } from "@/lib/radio/stations";
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
};

const INITIAL: Memory = {
  band: "fm",
  fm: 90,
  sw: 6000,
  pl: 94,
  volume: 0.78,
  caught: [],
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
  return { band, fm, sw, pl, volume, caught };
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
  const reduced = useReducedMotion();

  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const powerRef = useRef(on);
  powerRef.current = on;
  const scanTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const drag = useRef<{ x: number; y: number; freq: number; pointer: number } | null>(null);

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

  function stopNudge() {
    if (nudgeTimer.current) {
      clearInterval(nudgeTimer.current);
      nudgeTimer.current = null;
    }
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
    stopNudge();
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

  function startNudge(dir: -1 | 1) {
    stopScan();
    const stepOnce = () => {
      setMemory((current) => {
        const step = current.band === "sw" ? 40 : 0.1;
        return { ...current, [current.band]: clampFreq(current.band, current[current.band] + dir * step) };
      });
    };
    stepOnce();
    stopNudge();
    nudgeTimer.current = setInterval(stepOnce, 60);
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
      if (nudgeTimer.current) clearInterval(nudgeTimer.current);
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

  const windowLabel =
    !on ? "odbiornik śpi" : phase === "static" ? "między stacjami" : tuned.station.name;

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
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-xs tracking-widest text-cream/70 uppercase">Odbiornik nocny</p>
            <h1 className="font-display text-4xl text-balance sm:text-5xl">Radio Północy</h1>
            <p className="mt-2 max-w-md text-pretty text-cream/75">
              Dwanaście stacji, których nie ma w programie. Na paśmie Polska — prawdziwe anteny.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={on ? "Wyłącz odbiornik" : "Włącz odbiornik"}
              data-testid="power"
              className="power tap"
              onClick={() => (on ? turnOff() : turnOn())}
            >
              <span className={on ? "power-knob is-on" : "power-knob"} />
            </button>
            <span className="font-mono text-xs tracking-widest text-cream/70 uppercase">{on ? "wyłącz" : "włącz"}</span>
          </div>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-5">
          <section className="cabinet flex flex-col gap-4 p-4 sm:p-6 lg:col-span-3" aria-label="Odbiornik">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs tracking-widest text-cream/60">MODEL RP-00</p>
              <div className="flex gap-2" aria-hidden="true">
                <span className={on ? "lamp is-on" : "lamp"} />
                <span className={on && phase === "lock" ? "lamp is-on" : "lamp"} />
              </div>
            </div>

            <div className="well px-4 py-4 text-center">
              <p
                className={
                  on
                    ? tuned.strength < 0.4
                      ? "nixie is-on is-unstable flex items-baseline justify-center gap-2 font-mono text-4xl tabular-nums sm:text-6xl"
                      : "nixie is-on flex items-baseline justify-center gap-2 font-mono text-4xl tabular-nums sm:text-6xl"
                    : "nixie flex items-baseline justify-center gap-2 font-mono text-4xl tabular-nums sm:text-6xl"
                }
                data-testid="freq"
                data-freq={freq}
              >
                <span>{formatFreq(memory.band, freq)}</span>
                <span className="font-mono text-xs tracking-widest text-cream/70">{BANDS[memory.band].unit}</span>
              </p>
              <p className="mt-1 truncate font-display text-lg text-cream/80">{windowLabel}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="tap grid size-11 shrink-0 place-items-center rounded-full border border-cream/20 text-cream disabled:opacity-40"
                aria-label="Niższa częstotliwość"
                disabled={!on}
                onPointerDown={(event) => {
                  if (!on) return;
                  event.preventDefault();
                  try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  } catch {
                    /* already released */
                  }
                  startNudge(-1);
                }}
                onPointerUp={stopNudge}
                onPointerCancel={stopNudge}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
              </button>
              <div
                className={dragging ? "tuner relative h-20 min-w-0 flex-1 cursor-grabbing rounded-xl bg-ink/50" : "tuner relative h-20 min-w-0 flex-1 cursor-grab rounded-xl bg-ink/50"}
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
                    className="pointer-events-none absolute top-2 bottom-1 flex -translate-x-1/2 flex-col items-center"
                    style={{ left: `${dialPercent(memory.band, tick.freq)}%` }}
                  >
                    <span className={tick.major ? "h-4 w-px bg-cream/50" : "h-2 w-px bg-cream/25"} />
                    {tick.label ? (
                      <span className="mt-auto pb-1 font-mono text-xs text-cream/55">{tick.label}</span>
                    ) : null}
                  </span>
                ))}
                {bandStations.map((station) => (
                  <span
                    key={station.id}
                    className={
                      caughtIds.has(station.id)
                        ? "pointer-events-none absolute top-7 size-2 -translate-x-1/2 rounded-full bg-lamp"
                        : "pointer-events-none absolute top-7 size-2 -translate-x-1/2 rounded-full bg-lamp/35"
                    }
                    style={{ left: `${dialPercent(memory.band, station.freq)}%` }}
                  />
                ))}
                <span className="pointer" style={{ left: `${dialPercent(memory.band, freq)}%` }} />
              </div>
              <button
                type="button"
                className="tap grid size-11 shrink-0 place-items-center rounded-full border border-cream/20 text-cream disabled:opacity-40"
                aria-label="Wyższa częstotliwość"
                disabled={!on}
                onPointerDown={(event) => {
                  if (!on) return;
                  event.preventDefault();
                  try {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  } catch {
                    /* already released */
                  }
                  startNudge(1);
                }}
                onPointerUp={stopNudge}
                onPointerCancel={stopNudge}
              >
                <ChevronRight className="size-5" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:items-end">
              <div className="flex flex-col items-center gap-2">
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
                <span className="font-mono text-xs tracking-widest text-cream/55">STROJENIE</span>
              </div>
              <Meter on={on} strength={tuned.strength} reduced={reduced} label={word} />
              <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
                <button
                  type="button"
                  className="tap grid size-11 shrink-0 place-items-center rounded-full border border-cream/20 text-cream"
                  aria-label={memory.volume <= 0.01 ? "Włącz dźwięk" : "Wycisz"}
                  onClick={() =>
                    setMemory((current) => ({
                      ...current,
                      volume: current.volume <= 0.01 ? 0.78 : 0,
                    }))
                  }
                >
                  {memory.volume <= 0.01 ? (
                    <VolumeX className="size-5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="size-5" aria-hidden="true" />
                  )}
                </button>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex items-baseline justify-between font-mono text-xs tracking-widest text-cream/55">
                    <span>GŁOŚNOŚĆ</span>
                    <span className="tabular-nums">{Math.round(memory.volume * 100)}</span>
                  </span>
                  <input
                    className="fader"
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={memory.volume}
                    aria-label="Głośność"
                    suppressHydrationWarning
                    onChange={(event) =>
                      setMemory((current) => ({ ...current, volume: clamp01(Number(event.target.value)) }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <div
                role="radiogroup"
                aria-label="Zakres"
                className="grid grid-cols-3 gap-1 rounded-full bg-ink/45 p-1"
              >
                {(["fm", "sw", "pl"] as const).map((band) => (
                  <button
                    key={band}
                    type="button"
                    role="radio"
                    aria-checked={memory.band === band}
                    data-testid={band === "sw" ? "band-sw" : band === "pl" ? "band-pl" : "band-fm"}
                    className={
                      memory.band === band
                        ? "tap h-11 whitespace-nowrap rounded-full bg-lamp px-1 font-mono text-xs text-ink sm:text-sm"
                        : "tap h-11 whitespace-nowrap rounded-full px-1 font-mono text-xs text-cream/80 sm:text-sm"
                    }
                    onClick={() => {
                      stopScan();
                      setMemory((current) => ({ ...current, band }));
                    }}
                  >
                    {band === "sw" ? (
                      <>
                        <span className="sm:hidden">Krótkie</span>
                        <span className="hidden sm:inline">Fale krótkie</span>
                      </>
                    ) : (
                      BANDS[band].label
                    )}
                  </button>
                ))}
              </div>
              <button
                type="button"
                data-testid="scan"
                className="tap h-11 rounded-full border border-lamp/50 px-4 font-mono text-sm text-lamp disabled:opacity-40"
                disabled={!on}
                aria-pressed={scanning}
                onClick={startScan}
              >
                {scanning ? "Zatrzymaj" : "Przeszukaj pasmo"}
              </button>
            </div>

            <Grille on={on} strength={tuned.strength} reduced={reduced} />
            {deaf ? (
              <p className="text-sm text-cream/70">
                Ta przeglądarka nie puszcza dźwięku. Kartka i tak się zapisze.
              </p>
            ) : null}
          </section>

          <div className="flex flex-col gap-6 lg:col-span-2">
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

function Meter({
  on,
  strength,
  reduced,
  label,
}: {
  on: boolean;
  strength: number;
  reduced: boolean;
  label: string;
}) {
  const needle = useRef<SVGLineElement>(null);
  useEffect(() => {
    const el = needle.current;
    if (!el) return;
    const paint = (angle: number) => {
      el.setAttribute("transform", `rotate(${angle} 50 58)`);
    };
    if (reduced || !on) {
      paint(-40 + strength * 80);
      return;
    }
    let raf = 0;
    const loop = (time: number) => {
      const wobble = (1 - strength) * 14 * Math.sin(time / 85);
      paint(-40 + strength * 80 + wobble);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [on, strength, reduced]);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 68" className="h-16 w-full max-w-40 text-cream/35" aria-hidden="true">
        <path d="M12 58 A38 38 0 0 1 88 58" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <line
          ref={needle}
          x1="50"
          y1="58"
          x2="50"
          y2="24"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="text-lamp"
        />
        <circle cx="50" cy="58" r="3" className="fill-lamp" />
      </svg>
      <span className="font-mono text-xs tracking-widest text-cream/55 uppercase">{label}</span>
    </div>
  );
}

function Grille({ on, strength }: { on: boolean; strength: number; reduced: boolean }) {
  const bars = [0.35, 0.7, 0.45, 0.9, 0.55, 0.8, 0.4, 1, 0.6, 0.85, 0.5, 0.75, 0.42, 0.95, 0.58, 0.72];
  return (
    <div className={on ? "grille grille-live flex items-center gap-1 px-3" : "grille flex items-center gap-1 px-3"} aria-hidden="true">
      {bars.map((level, index) => (
        <span
          key={index}
          className="grille-bar"
          style={{
            ["--bar" as string]: String(on ? 0.18 + level * (0.35 + (1 - strength) * 0.65) : 0.12),
            animationDelay: `${index * 70}ms`,
          }}
        />
      ))}
    </div>
  );
}
