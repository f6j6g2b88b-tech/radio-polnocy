#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = new URL(process.env.RADIO_TEST_URL || "http://127.0.0.1:8080/");
if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
  throw new Error("Radio regression checks must use a local test server.");
}
const output = resolve(process.env.RADIO_TEST_ARTIFACT_DIR || "artifacts/radio-browser");
await mkdir(output, { recursive: true });

function microphoneWave() {
  const sampleRate = 48_000;
  const frames = sampleRate * 4;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(frames * 2, 40);
  let phase = 0;
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    // Voiced harmonics with changing pitch and syllable-like amplitude. Keep
    // app echo cancellation/noise suppression enabled; a fixed tone or Chrome's
    // short default beep is a poor speech fixture for those processors.
    const pitch = 170 + 45 * Math.sin(2 * Math.PI * 0.75 * time);
    phase += (2 * Math.PI * pitch) / sampleRate;
    const envelope = 0.15 + 0.85 * Math.sin(2 * Math.PI * 1.75 * time) ** 2;
    const voice =
      0.35 * Math.sin(phase) +
      0.25 * Math.sin(phase * 3) +
      0.25 * Math.sin(phase * 5) +
      0.15 * Math.sin(phase * 7);
    wav.writeInt16LE(Math.round(0.7 * envelope * voice * 32_767), 44 + i * 2);
  }
  return wav;
}

// Chromium's documented file source loops WAV input through real getUserMedia:
// https://chromium.googlesource.com/chromium/src/+/HEAD/media/base/media_switches.cc
const microphoneFixture = resolve(output, "microphone-fixture.wav");
await writeFile(microphoneFixture, microphoneWave());
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
    : {}),
  args: [
    "--no-sandbox",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${microphoneFixture}`,
  ],
});
const errors = [];
const checks = [];
const sign = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "X");

async function makePage(viewport) {
  const context = await browser.newContext({ viewport, permissions: ["microphone"] });
  await context.addInitScript((relayOnly) => {
    window.__radioTest = { connections: [], tracks: [], captureSamples: [] };
    const NativePeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePeerConnection {
      constructor(config) {
        super(relayOnly ? { ...config, iceTransportPolicy: "relay" } : { ...config, iceServers: [] });
        window.__radioTest.connections.push(this);
      }
    };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      window.__radioTest.tracks.push(...stream.getTracks());
      return stream;
    };
  }, process.env.RADIO_TEST_RELAY === "1");
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Optional branding/fonts are external to the app and unrelated to this check.
  await page.route("https://grok.com/grok-app-builder/extensions.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" }),
  );
  const response = await page.goto(url.href, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  await page.getByRole("heading", { name: "Radio Północy", exact: true }).waitFor();
  assert.equal(await page.getByTestId("radio").isVisible(), true);
  return page;
}

async function join(page) {
  await page.getByTestId("power").click();
  await page.getByTestId("band-sw").click();
  await page.getByLabel("Wspólny znak, cztery znaki").fill(sign);
  await page.getByTestId("freq-entry").fill("7000");
  await page.getByTestId("freq-entry").press("Enter");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="net"]')?.getAttribute("data-signaling") === "connected",
  );
}

async function waitForTx(page, active) {
  await page.waitForFunction(
    (expected) => {
      const button = document.querySelector('[data-testid="ptt"]');
      return (
        button?.getAttribute("data-tx") === expected &&
        button?.getAttribute("data-microphone") === (expected === "on" ? "active" : "off")
      );
    },
    active ? "on" : "off",
  );
}

async function waitForCaptureStopped(page) {
  await page.waitForFunction(
    () =>
      window.__radioTest.tracks.length > 0 &&
      window.__radioTest.tracks.every((track) => track.readyState === "ended"),
  );
}

async function inboundAudio(page) {
  return page.evaluate(async () => {
    let packets = 0;
    let energy = null;
    const streams = [];
    for (const connection of window.__radioTest.connections) {
      if (connection.connectionState !== "connected") continue;
      const stats = await connection.getStats();
      stats.forEach((entry) => {
        if (entry.type === "inbound-rtp" && entry.kind === "audio") {
          packets += entry.packetsReceived ?? 0;
          if (typeof entry.totalAudioEnergy === "number") {
            energy = (energy ?? 0) + entry.totalAudioEnergy;
          }
          streams.push({ ...entry });
        }
      });
    }
    return { packets, energy, energyReported: energy !== null, streams };
  });
}

async function waitForRtp(page, before = { packets: 0 }) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const stats = await inboundAudio(page);
    // totalAudioEnergy is optional in RTP stats. Packet progress verifies
    // transport; the separate remote-only Web Audio RMS check verifies sound.
    if (stats.packets > before.packets + 10) return stats;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`No incoming audio RTP progress: ${JSON.stringify(await inboundAudio(page))}`);
}

async function audioDiagnostics(page) {
  return page.evaluate(async () => {
    const describeTrack = (track) =>
      track
        ? {
            id: track.id,
            kind: track.kind,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            settings: track.getSettings(),
          }
        : null;
    const peers = [];
    for (const connection of window.__radioTest.connections) {
      const audioStats = [];
      try {
        const stats = await connection.getStats();
        stats.forEach((entry) => {
          if (
            ["media-source", "outbound-rtp", "inbound-rtp", "remote-inbound-rtp"].includes(
              entry.type,
            ) &&
            (entry.kind === "audio" || entry.mediaType === "audio")
          ) {
            audioStats.push({ ...entry });
          }
        });
      } catch (error) {
        audioStats.push({ error: String(error) });
      }
      peers.push({
        connectionState: connection.connectionState,
        signalingState: connection.signalingState,
        iceConnectionState: connection.iceConnectionState,
        transceivers: connection.getTransceivers().map((item) => ({
          mid: item.mid,
          direction: item.direction,
          currentDirection: item.currentDirection,
          sender: describeTrack(item.sender.track),
          receiver: describeTrack(item.receiver.track),
        })),
        audioStats,
      });
    }
    const engine = window.__nightRadio;
    return {
      capturedTracks: window.__radioTest.tracks.map(describeTrack),
      captureSamples: window.__radioTest.captureSamples,
      engine: engine
        ? {
            contextState: engine.ctx.state,
            voices: engine.mouths.size,
            voiceGain: engine.voiceBus.gain.value,
            masterGain: engine.master.gain.value,
          }
        : null,
      peers,
    };
  });
}

async function waitForCapturedAudio(page) {
  const sample = await page.evaluate(async () => {
    const engine = window.__nightRadio;
    const track = window.__radioTest.tracks.find(
      (item) => item.kind === "audio" && item.readyState === "live",
    );
    if (!engine || !track) throw new Error("No live captured microphone to measure");
    const source = engine.ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = engine.ctx.createAnalyser();
    analyser.fftSize = 2048;
    const silentOutput = engine.ctx.createGain();
    silentOutput.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silentOutput);
    silentOutput.connect(engine.ctx.destination);
    const values = new Float32Array(analyser.fftSize);
    const deadline = performance.now() + 5000;
    let peakRms = 0;
    try {
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(values);
        const rms = Math.sqrt(
          values.reduce((sum, value) => sum + value * value, 0) / values.length,
        );
        peakRms = Math.max(peakRms, rms);
        if (peakRms > 0.00001 && track.enabled && !track.muted) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const result = {
        trackId: track.id,
        contextState: engine.ctx.state,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        settings: track.getSettings(),
        peakRms,
      };
      window.__radioTest.captureSamples.push(result);
      return result;
    } finally {
      source.disconnect();
      analyser.disconnect();
      silentOutput.disconnect();
    }
  });
  assert.ok(
    sample.contextState === "running" &&
      sample.readyState === "live" &&
      sample.enabled &&
      !sample.muted &&
      sample.peakRms > 0.00001,
    `Captured microphone is silent before WebRTC: ${JSON.stringify(sample)}`,
  );
  return sample;
}

async function waitForSendingTrack(page) {
  await page.waitForFunction(() =>
    window.__radioTest.connections.some(
      (connection) =>
        connection.connectionState === "connected" &&
        connection.getTransceivers().some((item) => {
          const track = item.sender.track;
          return (
            item.currentDirection === "sendrecv" &&
            track?.kind === "audio" &&
            track.readyState === "live" &&
            track.enabled &&
            !track.muted
          );
        }),
    ),
  );
}

async function waitForPlayback(page) {
  return page.evaluate(async () => {
    const engine = window.__nightRadio;
    if (!engine) throw new Error("Receiver audio engine is missing");
    const analyser = engine.ctx.createAnalyser();
    analyser.fftSize = 2048;
    const samples = new Float32Array(analyser.fftSize);
    // Listen only to the remote voice bus. The receiver's synthetic hiss must
    // not make this check pass when incoming speech never reaches Web Audio.
    engine.voiceBus.connect(analyser);
    const deadline = performance.now() + 15_000;
    let snapshot;
    try {
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length,
        );
        snapshot = {
          contextState: engine.ctx.state,
          voices: engine.mouths.size,
          voiceGain: engine.voiceBus.gain.value,
          masterGain: engine.master.gain.value,
          rms,
        };
        if (
          snapshot.contextState === "running" &&
          snapshot.voices > 0 &&
          snapshot.voiceGain > 0.01 &&
          snapshot.masterGain > 0.01 &&
          rms > 0.00001
        ) {
          return snapshot;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(
        `Incoming voice did not reach receiver playback: ${JSON.stringify(snapshot)}`,
      );
    } finally {
      try {
        engine.voiceBus.disconnect(analyser);
      } catch {
        // Teardown may already have disconnected the engine on a failing run.
      }
      analyser.disconnect();
    }
  });
}

async function readJournal(page) {
  return page.locator('section[aria-label="Dziennik nasłuchu"] li').evaluateAll((items) =>
    items.map((item) => {
      const lines = item.querySelectorAll("p");
      return { station: lines[0]?.textContent.trim(), details: lines[1]?.textContent.trim() };
    }),
  );
}

async function checkLayout(page, filename) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    ),
    false,
    "no horizontal overflow",
  );
  await page.screenshot({ path: resolve(output, filename), fullPage: true });
}

let first;
let second;
try {
  first = await makePage({ width: 1280, height: 900 });
  await checkLayout(first, "desktop.png");
  await join(first);
  await first.getByTestId("ptt").click();
  await waitForTx(first, true);
  const captureFromFirst = await waitForCapturedAudio(first);
  checks.push("transmission starts on an empty channel");

  second = await makePage({ width: 390, height: 844 });
  await join(second);
  await second.getByTestId("net-status").filter({ hasText: "Ktoś nadaje" }).waitFor();
  await waitForSendingTrack(first);
  const toSecond = await waitForRtp(second);
  const firstSending = await audioDiagnostics(first);
  const playbackToSecond = await waitForPlayback(second);
  checks.push("late joiner receives transmitting state, non-silent RTP and Web Audio playback");
  await checkLayout(second, "mobile.png");

  for (const page of [first, second]) {
    const directions = await page.evaluate(() =>
      window.__radioTest.connections
        .filter((pc) => pc.connectionState === "connected")
        .flatMap((pc) => pc.getTransceivers().map((item) => item.currentDirection)),
    );
    assert.ok(directions.length > 0);
    assert.ok(directions.every((direction) => direction === "sendrecv"));
  }
  checks.push("both participants negotiated sendrecv");
  if (process.env.RADIO_TEST_RELAY === "1") {
    for (const page of [first, second]) {
      const type = await page.evaluate(async () => {
        const pc = window.__radioTest.connections.find((conn) => conn.connectionState === "connected");
        const stats = await pc.getStats();
        const transport = [...stats.values()].find((item) => item.type === "transport" && item.selectedCandidatePairId);
        const pair = stats.get(transport.selectedCandidatePairId);
        return stats.get(pair.localCandidateId).candidateType;
      });
      assert.equal(type, "relay");
    }
    checks.push("both browsers selected TURN relay candidates");
  }

  await first.getByTestId("ptt").click();
  await waitForTx(first, false);
  await waitForCaptureStopped(first);
  const before = await inboundAudio(first);
  await second.getByTestId("ptt").click();
  await waitForTx(second, true);
  const captureFromSecond = await waitForCapturedAudio(second);
  await waitForSendingTrack(second);
  await first.getByTestId("net-status").filter({ hasText: "Ktoś nadaje" }).waitFor();
  const toFirst = await waitForRtp(first, before);
  const secondSending = await audioDiagnostics(second);
  const playbackToFirst = await waitForPlayback(first);
  checks.push(
    "reverse transmission reaches Web Audio playback and stopped sender releases capture",
  );

  await second.getByTestId("power").click();
  await waitForCaptureStopped(second);
  await second.waitForFunction(() => window.__nightRadio?.mouths.size === 0);
  await first.waitForFunction(() => window.__nightRadio?.mouths.size === 0);
  checks.push("power off stops microphone and removes both remote audio graphs");

  await second.getByTestId("power").click();
  await second.getByTestId("net-status").filter({ hasText: "Korespondentów: 1" }).waitFor();
  const beforeReconnect = await inboundAudio(first);
  await second.getByTestId("ptt").click();
  await waitForTx(second, true);
  await waitForCapturedAudio(second);
  await waitForSendingTrack(second);
  await waitForRtp(first, beforeReconnect);
  const playbackAfterReconnect = await waitForPlayback(first);
  await second.getByTestId("freq-entry").fill("7200");
  await second.getByTestId("freq-entry").press("Enter");
  await waitForTx(second, false);
  await waitForCaptureStopped(second);
  checks.push("power cycle reconnects, and retuning stops microphone");

  await first.getByTestId("band-fm").click();
  await first.getByTestId("scan").click();
  await first.waitForFunction(
    () => document.querySelector('[data-testid="scan"]')?.getAttribute("aria-pressed") === "false",
  );
  await first.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem("radio-polnocy-v1") || "{}");
    return saved.band === "fm" && saved.caught?.length > 0;
  });
  const savedFrequency = await first.getByTestId("freq").getAttribute("data-freq");
  const scannedStation = (await first.getByTestId("station").textContent()).trim();
  await first
    .locator('section[aria-label="Dziennik nasłuchu"]')
    .getByText(scannedStation, { exact: true })
    .waitFor();
  const savedJournal = await readJournal(first);
  assert.ok(savedJournal.length > 0, "the caught station appears in the rendered journal");
  await first.reload({ waitUntil: "networkidle" });
  await first.waitForFunction(
    (expected) =>
      document.querySelector('[data-testid="freq"]')?.getAttribute("data-freq") === expected,
    savedFrequency,
  );
  await first
    .locator('section[aria-label="Dziennik nasłuchu"]')
    .getByText(savedJournal[0].station, { exact: true })
    .waitFor();
  assert.deepEqual(await readJournal(first), savedJournal, "rendered journal survives reload");
  checks.push("scanning catches a station and tuning/rendered journal persist after reload");

  await first.getByRole("button", { name: "Zapisz stację" }).click();
  await first.waitForFunction(() => JSON.parse(localStorage.getItem("radio-polnocy-v1")).presets[0]);
  await first.reload();
  await first.getByTestId("band-sw").click();
  await first.getByLabel("Ulubione").selectOption("5");
  await first.getByRole("button", { name: "Zapisz stację" }).click();
  await first.getByLabel("Ulubione").selectOption("0");
  await first.getByRole("button", { name: "Włącz stację" }).click();
  assert.equal(await first.getByTestId("freq").getAttribute("data-freq"), savedFrequency);
  assert.equal(await first.getByTestId("band-fm").getAttribute("aria-checked"), "true");
  await first.clock.install();
  await first.getByLabel("Wyłącznik czasowy").selectOption("15");
  await first.getByLabel("Wyłącznik czasowy").selectOption("0");
  await first.clock.fastForward("15:01");
  assert.equal(await first.getByTestId("power").getAttribute("aria-checked"), "true");
  await first.getByLabel("Wyłącznik czasowy").selectOption("15");
  await first.clock.fastForward("15:01");
  await first.waitForFunction(() => document.querySelector('[data-testid="power"]').getAttribute("aria-checked") === "false");
  checks.push("favorites persist independently and sleep timer cancels or powers off");
  assert.deepEqual(errors, [], "no uncaught page or console errors");
  const verdict = {
    ok: true,
    url: url.href,
    checks,
    toFirst,
    toSecond,
    captureFromFirst,
    captureFromSecond,
    firstSending,
    secondSending,
    playbackToFirst,
    playbackToSecond,
    playbackAfterReconnect,
    savedJournal,
    errors,
  };
  await writeFile(resolve(output, "verdict.json"), JSON.stringify(verdict, null, 2));
  console.log(JSON.stringify(verdict, null, 2));
} catch (error) {
  const diagnostics = {};
  for (const [label, page] of [
    ["first", first],
    ["second", second],
  ]) {
    if (page && !page.isClosed()) {
      diagnostics[label] = await audioDiagnostics(page).catch((failure) => ({
        error: String(failure),
      }));
      await page
        .screenshot({ path: resolve(output, `${label}-failure.png`), fullPage: true })
        .catch(() => {});
    }
  }
  const verdict = { ok: false, checks, errors, diagnostics, error: String(error?.stack || error) };
  await writeFile(resolve(output, "verdict.json"), JSON.stringify(verdict, null, 2));
  console.error(JSON.stringify(verdict, null, 2));
  throw error;
} finally {
  await browser.close();
}
