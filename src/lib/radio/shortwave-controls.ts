import { clampFreq } from "@/lib/radio/tuning";

export function waveChannel(freq: number) {
  return Math.round(clampFreq("sw", freq) / 10) * 10;
}

export function normalizeSign(raw: string) {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 4);
}
