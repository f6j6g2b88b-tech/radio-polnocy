import assert from "node:assert/strict";
import test from "node:test";
import { MicrophoneCapture } from "./microphone.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function captureFixture(state: MediaStreamTrackState = "live") {
  let audioStops = 0;
  let otherStops = 0;
  let readyState = state;
  const audio = {
    get readyState() {
      return readyState;
    },
    stop() {
      audioStops++;
      readyState = "ended";
    },
  } as MediaStreamTrack;
  const other = { stop: () => otherStops++ } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [audio],
    getTracks: () => [audio, other],
  } as unknown as MediaStream;
  return { audio, stream, stops: () => ({ audio: audioStops, other: otherStops }) };
}

test("release stops every captured track and is idempotent", async () => {
  const fixture = captureFixture();
  const microphone = new MicrophoneCapture(async () => fixture.stream);
  assert.equal(await microphone.acquire(), fixture.audio);
  assert.deepEqual(fixture.stops(), { audio: 0, other: 0 });
  microphone.release();
  microphone.release();
  assert.deepEqual(fixture.stops(), { audio: 1, other: 1 });
});

test("a late permission grant after cancellation is stopped and never returned", async () => {
  const permission = deferred<MediaStream>();
  const fixture = captureFixture();
  const microphone = new MicrophoneCapture(() => permission.promise);
  const result = microphone.acquire();
  microphone.release();
  permission.resolve(fixture.stream);
  assert.equal(await result, null);
  assert.deepEqual(fixture.stops(), { audio: 1, other: 1 });
});

test("a late permission denial after cancellation does not report an error", async () => {
  const permission = deferred<MediaStream>();
  const microphone = new MicrophoneCapture(() => permission.promise);
  const result = microphone.acquire();
  microphone.release();
  permission.reject(new Error("Permission denied"));
  assert.equal(await result, null);
});

test("cancel then restart serializes permission requests and stops the stale stream", async () => {
  const firstPermission = deferred<MediaStream>();
  const secondPermission = deferred<MediaStream>();
  const firstFixture = captureFixture();
  const secondFixture = captureFixture();
  let requests = 0;
  const microphone = new MicrophoneCapture(() => {
    requests++;
    return requests === 1 ? firstPermission.promise : secondPermission.promise;
  });
  const first = microphone.acquire();
  microphone.release();
  const second = microphone.acquire();
  assert.equal(requests, 1, "one browser permission prompt at a time");
  firstPermission.resolve(firstFixture.stream);
  assert.equal(await first, null);
  assert.equal(requests, 2);
  assert.deepEqual(firstFixture.stops(), { audio: 1, other: 1 });
  secondPermission.resolve(secondFixture.stream);
  assert.equal(await second, secondFixture.audio);
  microphone.release();
  assert.deepEqual(secondFixture.stops(), { audio: 1, other: 1 });
});

test("cancellation also invalidates a queued restart", async () => {
  const permission = deferred<MediaStream>();
  const fixture = captureFixture();
  let requests = 0;
  const microphone = new MicrophoneCapture(() => {
    requests++;
    return permission.promise;
  });
  const first = microphone.acquire();
  microphone.release();
  const queued = microphone.acquire();
  microphone.release();
  permission.resolve(fixture.stream);
  assert.equal(await first, null);
  assert.equal(await queued, null);
  assert.equal(requests, 1);
  assert.deepEqual(fixture.stops(), { audio: 1, other: 1 });
});

test("current permission failures remain visible and a retry can succeed", async () => {
  const fixture = captureFixture();
  let requests = 0;
  const microphone = new MicrophoneCapture(async () => {
    if (++requests === 1) throw new Error("Permission denied");
    return fixture.stream;
  });
  await assert.rejects(microphone.acquire(), /Permission denied/);
  assert.equal(await microphone.acquire(), fixture.audio);
  microphone.release();
  assert.deepEqual(fixture.stops(), { audio: 1, other: 1 });
});

test("a stream without a live microphone is closed and rejected", async () => {
  const fixture = captureFixture("ended");
  const microphone = new MicrophoneCapture(async () => fixture.stream);
  await assert.rejects(microphone.acquire(), /aktywnej ścieżki/);
  assert.deepEqual(fixture.stops(), { audio: 1, other: 1 });
});
