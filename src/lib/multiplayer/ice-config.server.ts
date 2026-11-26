import { createHmac } from "node:crypto";

type RtcEnvironment = {
  TURN_URLS?: string;
  TURN_SHARED_SECRET?: string;
  VERCEL?: string;
  DATABASE_URL?: string;
};

const CREDENTIAL_LIFETIME_SECONDS = 60 * 60;
const CREDENTIAL_REFRESH_SECONDS = 5 * 60;

/** An embedded, per-process DB cannot rendezvous across serverless instances. */
export function needsSharedDatabase(env: RtcEnvironment = process.env): boolean {
  return (env.VERCEL === "1" || env.VERCEL === "true") && !env.DATABASE_URL?.trim();
}

/**
 * Coturn TURN REST credentials. Keep TURN_SHARED_SECRET server-only; clients
 * receive only credentials that expire within one hour. Polls rotate them
 * every five minutes, giving established sessions plenty of overlap.
 */
export function turnIceServers(
  peerId: string,
  env: RtcEnvironment = process.env,
  now = Date.now(),
): RTCIceServer[] {
  const urls =
    env.TURN_URLS?.split(",")
      .map((url) => url.trim())
      .filter(Boolean) ?? [];
  const secret = env.TURN_SHARED_SECRET?.trim();
  if (!urls.length && !secret) return [];
  if (!urls.length || !secret || urls.some((url) => !/^turns?:[^\s]+$/.test(url))) {
    throw new Error("TURN_URLS and TURN_SHARED_SECRET must configure a TURN service together");
  }
  const bucket = Math.floor(now / 1000 / CREDENTIAL_REFRESH_SECONDS) * CREDENTIAL_REFRESH_SECONDS;
  const username = `${bucket + CREDENTIAL_LIFETIME_SECONDS}:radio:${peerId}`;
  const credential = createHmac("sha1", secret).update(username).digest("base64");
  return [{ urls, username, credential }];
}
