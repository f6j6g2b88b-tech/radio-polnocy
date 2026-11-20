import { STATIONS, type BandId, type Station } from "@/lib/radio/stations";

export const BANDS = {
  fm: {
    min: 87.5,
    max: 108,
    fine: 0.05,
    coarse: 0.25,
    hear: 0.85,
    unit: "MHz",
    label: "FM",
  },
  sw: {
    min: 3000,
    max: 12000,
    fine: 10,
    coarse: 80,
    hear: 340,
    unit: "kHz",
    label: "Fale krótkie",
  },
} as const;

export type Tune = {
  station: Station;
  dist: number;
  strength: number;
  place: number;
};

export type Phase = "off" | "static" | "near" | "lock";

export function clamp01(n: number) {
  return Math.min(1, Math.max(0, n));
}

export function clampFreq(band: BandId, freq: number) {
  const spec = BANDS[band];
  return Math.min(spec.max, Math.max(spec.min, freq));
}

export function describe(band: BandId, freq: number): Tune {
  const spec = BANDS[band];
  const clamped = clampFreq(band, freq);
  const place = (clamped - spec.min) / (spec.max - spec.min);
  const list = STATIONS.filter((station) => station.band === band);
  let station = list[0];
  let dist = Infinity;
  for (const candidate of list) {
    const delta = Math.abs(candidate.freq - clamped);
    if (delta < dist) {
      dist = delta;
      station = candidate;
    }
  }
  let strength = 0;
  if (station && dist < spec.hear) {
    const t = 1 - dist / spec.hear;
    strength = t * t * (3 - 2 * t);
  }
  if (!station) {
    throw new Error("Brak stacji na tym zakresie");
  }
  return { station, dist, strength, place };
}

export function formatFreq(band: BandId, freq: number) {
  const clamped = clampFreq(band, freq);
  if (band === "fm") return clamped.toFixed(2).replace(".", ",");
  return String(Math.round(clamped));
}

export function signalWord(on: boolean, strength: number) {
  if (!on) return "uśpiony";
  if (strength > 0.9) return "czysto";
  if (strength > 0.72) return "blisko";
  if (strength > 0.4) return "daleko";
  if (strength > 0.08) return "ślad";
  return "szum";
}

export function phaseOf(on: boolean, strength: number): Phase {
  if (!on) return "off";
  if (strength >= 0.8) return "lock";
  if (strength >= 0.45) return "near";
  return "static";
}

export function dialPercent(band: BandId, freq: number) {
  const spec = BANDS[band];
  const t = (clampFreq(band, freq) - spec.min) / (spec.max - spec.min);
  return 6 + t * 88;
}

export function scaleTicks(band: BandId): { freq: number; label?: string; major: boolean }[] {
  const ticks: { freq: number; label?: string; major: boolean }[] = [];
  if (band === "fm") {
    for (let freq = 88; freq <= 108; freq += 1) {
      const major = freq % 4 === 0;
      ticks.push({ freq, major, label: major ? String(freq) : undefined });
    }
    return ticks;
  }
  for (let freq = 3000; freq <= 12000; freq += 500) {
    const major = freq % 3000 === 0;
    ticks.push({ freq, major, label: major ? String(freq / 1000) : undefined });
  }
  return ticks;
}
