import assert from "node:assert/strict";
import test from "node:test";
import { RemoteVoice } from "./remote-voice.ts";

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

class FakeNode {
  connections: FakeNode[] = [];
  disconnects = 0;
  connect(destination: FakeNode) {
    this.connections.push(destination);
    return destination;
  }
  disconnect() {
    this.disconnects += 1;
    this.connections = [];
  }
}

class FakeAudio {
  muted = false;
  autoplay = false;
  paused = true;
  plays = 0;
  pauses = 0;
  attributes = new Map<string, string>();
  sourceAssignments: { stream: MediaStream | null; muted: boolean }[] = [];
  playSnapshots: { stream: MediaStream | null; muted: boolean }[] = [];
  nextPlay: Promise<void> | null = null;
  playError: Error | null = null;
  private source: MediaStream | null = null;

  get srcObject() {
    return this.source;
  }
  set srcObject(stream: MediaStream | null) {
    this.sourceAssignments.push({ stream, muted: this.muted });
    this.source = stream;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  play(): Promise<void> {
    this.plays += 1;
    this.playSnapshots.push({ stream: this.source, muted: this.muted });
    if (this.playError) return Promise.reject(this.playError);
    this.paused = false;
    const pending = this.nextPlay;
    this.nextPlay = null;
    return pending ?? Promise.resolve();
  }
  pause() {
    this.pauses += 1;
    this.paused = true;
  }
}

function setup(audio = new FakeAudio()) {
  const destination = new FakeNode();
  const source = new FakeNode();
  const filter = Object.assign(new FakeNode(), {
    type: "lowpass",
    frequency: { value: 350 },
    Q: { value: 1 },
  });
  const gain = Object.assign(new FakeNode(), { gain: { value: 1 } });
  let trackStops = 0;
  let elements = 0;
  const track = { stop: () => trackStops++ } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  const sourceStreams: MediaStream[] = [];
  const ctx = {
    createMediaStreamSource(value: MediaStream) {
      sourceStreams.push(value);
      return source;
    },
    createBiquadFilter: () => filter,
    createGain: () => gain,
    createMediaElementSource() {
      assert.fail("the muted RTC anchor must not add another audio graph path");
    },
  } as unknown as AudioContext;
  const voice = new RemoteVoice(ctx, destination as unknown as AudioNode, stream, () => {
    elements += 1;
    return audio as unknown as HTMLAudioElement;
  });
  return {
    voice,
    audio,
    stream,
    source,
    filter,
    gain,
    destination,
    sourceStreams,
    elements: () => elements,
    trackStops: () => trackStops,
  };
}

test("the RTC anchor is muted before attaching or playing the remote stream", () => {
  const { voice, audio, stream, elements } = setup();
  try {
    assert.deepEqual(audio.sourceAssignments, [{ stream, muted: true }]);
    assert.deepEqual(audio.playSnapshots, [{ stream, muted: true }]);
    assert.equal(audio.muted, true);
    assert.equal(audio.autoplay, true);
    assert.equal(audio.attributes.has("playsinline"), true);
    assert.equal(elements(), 1);
  } finally {
    voice.dispose();
  }
});

test("received audio has one filtered path through the supplied radio bus", () => {
  const state = setup();
  try {
    assert.deepEqual(state.sourceStreams, [state.stream]);
    assert.deepEqual(state.source.connections, [state.filter]);
    assert.deepEqual(state.filter.connections, [state.gain]);
    assert.deepEqual(state.gain.connections, [state.destination]);
    assert.equal(state.filter.type, "bandpass");
    assert.equal(state.filter.frequency.value, 1200);
    assert.equal(state.filter.Q.value, 0.65);
    assert.equal(state.gain.gain.value, 1.6);
  } finally {
    state.voice.dispose();
  }
});

test("resume does not overlap a pending play attempt or restart a playing anchor", async () => {
  const pending = deferred();
  const audio = new FakeAudio();
  audio.nextPlay = pending.promise;
  const { voice, elements } = setup(audio);
  try {
    // pause() can change the element's state before its play promise rejects.
    audio.pause();
    voice.resume();
    voice.resume();
    assert.equal(audio.plays, 1);
    pending.reject(new DOMException("Interrupted by pause", "AbortError"));
    await settle();
    voice.resume();
    assert.equal(audio.plays, 2);
    await settle();
    voice.resume();
    voice.resume();
    assert.equal(audio.plays, 2);
    assert.equal(elements(), 1);
  } finally {
    voice.dispose();
  }
});

test("a rejected autoplay attempt can be retried on the same muted anchor", async () => {
  const audio = new FakeAudio();
  audio.playError = new DOMException("User gesture required", "NotAllowedError");
  const { voice, stream, elements } = setup(audio);
  try {
    await settle();
    assert.equal(audio.paused, true);
    audio.playError = null;
    voice.resume();
    await settle();
    assert.equal(audio.plays, 2);
    assert.equal(audio.paused, false);
    assert.equal(audio.srcObject, stream);
    assert.equal(elements(), 1);
    assert.ok(audio.playSnapshots.every((attempt) => attempt.muted));
  } finally {
    voice.dispose();
  }
});

test("resume restarts an anchor paused after successful playback without rebuilding the graph", async () => {
  const { voice, audio, sourceStreams, elements } = setup();
  try {
    await settle();
    audio.pause();
    voice.resume();
    await settle();
    assert.equal(audio.plays, 2);
    assert.equal(audio.paused, false);
    assert.equal(elements(), 1);
    assert.equal(sourceStreams.length, 1);
  } finally {
    voice.dispose();
  }
});

test("dispose stops playback and disconnects every node once without stopping remote tracks", async () => {
  const { voice, audio, source, filter, gain, trackStops } = setup();
  await settle();
  voice.dispose();
  voice.dispose();
  voice.resume();
  assert.equal(audio.pauses, 1);
  assert.equal(audio.paused, true);
  assert.equal(audio.autoplay, false);
  assert.equal(audio.srcObject, null);
  assert.equal(audio.plays, 1);
  for (const node of [source, filter, gain]) {
    assert.equal(node.disconnects, 1);
    assert.deepEqual(node.connections, []);
  }
  assert.equal(trackStops(), 0);
});

for (const outcome of ["resolved", "rejected"] as const) {
  test(`a ${outcome} play promise after disposal cannot restart or reattach the stream`, async () => {
    const pending = deferred();
    const audio = new FakeAudio();
    audio.nextPlay = pending.promise;
    const { voice, source, filter, gain, trackStops } = setup(audio);
    voice.dispose();
    if (outcome === "resolved") pending.resolve();
    else pending.reject(new DOMException("Disposed", "AbortError"));
    await settle();
    voice.resume();
    voice.dispose();
    assert.equal(audio.plays, 1);
    assert.equal(audio.pauses, 1);
    assert.equal(audio.paused, true);
    assert.equal(audio.autoplay, false);
    assert.equal(audio.srcObject, null);
    assert.deepEqual(audio.sourceAssignments.map((assignment) => assignment.stream === null), [
      false,
      true,
    ]);
    for (const node of [source, filter, gain]) assert.equal(node.disconnects, 1);
    assert.equal(trackStops(), 0);
  });
}
