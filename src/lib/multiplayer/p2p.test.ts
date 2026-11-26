import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { setImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { P2PRoom, type PeerInfo, type P2PRoomOptions, type RtcPollResponse } from "./p2p.ts";

class Channel {
  readyState: RTCDataChannelState = "connecting";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: string[] = [];
  constructor(readonly label: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = "open";
    this.onopen?.();
  }
  close() {
    this.readyState = "closed";
  }
}

class Sender {
  track: MediaStreamTrack | null = null;
  replacements: (MediaStreamTrack | null)[] = [];
  replace: ((track: MediaStreamTrack | null) => Promise<void>) | null = null;
  async replaceTrack(track: MediaStreamTrack | null) {
    this.replacements.push(track);
    if (this.replace) await this.replace(track);
    this.track = track;
  }
}

class Transceiver {
  sender = new Sender();
  receiver = { track: { kind: "audio" } };
  constructor(public direction: RTCRtpTransceiverDirection) {}
}

/** Models SDP direction explicitly: remote-created transceivers are recvonly. */
class Connection {
  static instances: Connection[] = [];
  connectionState: RTCPeerConnectionState = "new";
  signalingState: RTCSignalingState = "stable";
  localDescription: { type: RTCSdpType; sdp: string; toJSON(): RTCSessionDescriptionInit } | null =
    null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  transceivers: Transceiver[] = [];
  channels: Channel[] = [];
  configurations: RTCConfiguration[] = [];
  restarts = 0;
  rejectRemoteOffer = false;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onnegotiationneeded: (() => Promise<void>) | null = null;
  ondatachannel: ((event: { channel: Channel }) => void) | null = null;
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null;
  constructor(configuration: RTCConfiguration) {
    this.configurations.push(configuration);
    Connection.instances.push(this);
  }
  addTransceiver(_kind: string, options: { direction: RTCRtpTransceiverDirection }) {
    const transceiver = new Transceiver(options.direction);
    this.transceivers.push(transceiver);
    return transceiver;
  }
  getTransceivers() {
    return this.transceivers;
  }
  createDataChannel(label: string) {
    const channel = new Channel(label);
    this.channels.push(channel);
    return channel;
  }
  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    if (this.rejectRemoteOffer && description.type === "offer") throw new Error("stale transport");
    this.remoteDescription = description;
    if (description.type === "offer") {
      if (!this.transceivers.length) this.transceivers.push(new Transceiver("recvonly"));
      this.signalingState = "have-remote-offer";
    } else this.signalingState = "stable";
  }
  async setLocalDescription() {
    const type: RTCSdpType = this.signalingState === "have-remote-offer" ? "answer" : "offer";
    const sdp = this.transceivers.map((item) => `a=${item.direction}`).join("\r\n");
    this.localDescription = { type, sdp, toJSON: () => ({ type, sdp }) };
    this.signalingState = type === "answer" ? "stable" : "have-local-offer";
  }
  async addIceCandidate() {}
  async getStats() {
    return new Map();
  }
  restartIce() {
    this.restarts++;
  }
  setConfiguration(configuration: RTCConfiguration) {
    this.configurations.push(configuration);
  }
  close() {
    this.connectionState = "closed";
    this.signalingState = "closed";
  }
}

type PollBody = () => RtcPollResponse | Response;
function setup(t: TestContext, pollBody: PollBody, options: Partial<P2PRoomOptions> = {}) {
  Connection.instances = [];
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "RTCPeerConnection");
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: Connection });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "RTCPeerConnection", descriptor);
    else Reflect.deleteProperty(globalThis, "RTCPeerConnection");
  });
  const posts: { op: string; kind?: string; payload?: RTCSessionDescriptionInit }[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      return Response.json({ ok: true });
    }
    const body = pollBody();
    return body instanceof Response ? body : Response.json(body);
  });
  const room = new P2PRoom({ room: "test", selfId: "z", ...options });
  t.after(() => room.close());
  return { room, posts };
}

function poll(room: P2PRoom) {
  // Drive the next real poll without waiting for a wall-clock timer.
  return (room as unknown as { poll(): Promise<void> }).poll();
}

function watchdog(room: P2PRoom) {
  // Advance recovery deterministically without waiting for its interval.
  (room as unknown as { watchdog(): void }).watchdog();
}

/** A real HTTP response whose headers arrive before its JSON body finishes. */
async function streamingSignaling(t: TestContext) {
  let firstResponse: ServerResponse | undefined;
  let firstSignal: AbortSignal | null | undefined;
  let gets = 0;
  let headersReceived!: () => void;
  const firstHeaders = new Promise<void>((resolve) => {
    headersReceived = resolve;
  });
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "POST") {
      response.end('{"ok":true}');
    } else if (++gets === 1) {
      firstResponse = response;
      response.writeHead(200);
      response.flushHeaders();
      response.write('{"peers":[],"signals":');
    } else {
      response.end('{"peers":[],"signals":[]}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const response = await realFetch(
      new URL(String(input), `http://127.0.0.1:${address.port}`),
      init,
    );
    if (init?.method !== "POST" && !firstSignal) {
      firstSignal = init?.signal;
      headersReceived();
    }
    return response;
  });
  return {
    firstHeaders,
    finishBody: () => firstResponse!.end("[]}"),
    signal: () => firstSignal,
    getCount: () => gets,
  };
}

const roster = [
  { id: "a", name: "Alice" },
  { id: "z", name: "Zoe" },
];
const audioTrack = () => ({ kind: "audio", readyState: "live" }) as MediaStreamTrack;

test("the answer negotiates return audio before either person enables a microphone", async (t) => {
  const { room, posts } = setup(
    t,
    () => ({
      peers: roster,
      signals: [{ id: 1, from: "z", kind: "offer", payload: { type: "offer", sdp: "a=sendrecv" } }],
    }),
    { selfId: "a" },
  );
  await room.join();
  const peer = Connection.instances[0];
  assert.equal(peer.transceivers[0].direction, "sendrecv");
  assert.equal(posts.find((post) => post.kind === "answer")?.payload?.sdp, "a=sendrecv");
  const track = audioTrack();
  room.setMic(track);
  await setImmediate();
  assert.equal(peer.transceivers[0].sender.track, track);
  assert.equal(peer.transceivers[0].direction, "sendrecv");
});

test("stopping during a slow microphone replacement leaves the sender detached", async (t) => {
  const { room } = setup(t, () => ({ peers: roster, signals: [] }));
  await room.join();
  const sender = Connection.instances[0].transceivers[0].sender;
  let finish!: () => void;
  sender.replace = async (track) => {
    if (track)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  };
  const track = audioTrack();
  room.setMic(track);
  await setImmediate();
  room.setMic(null);
  assert.equal(sender.replacements.length, 1, "detach waits for the older replacement");
  finish();
  await setImmediate();
  assert.deepEqual(sender.replacements, [track, null]);
  assert.equal(sender.track, null);
});

test("microphone replacement errors reach the UI and do not poison later replacements", async (t) => {
  const errors: Error[] = [];
  const { room } = setup(t, () => ({ peers: roster, signals: [] }), {
    onMicError: (error) => errors.push(error),
  });
  await room.join();
  const sender = Connection.instances[0].transceivers[0].sender;
  sender.replace = async () => {
    throw new Error("replace failed");
  };
  room.setMic(audioTrack());
  await setImmediate();
  assert.equal(errors.length, 1);
  sender.replace = null;
  const next = audioTrack();
  room.setMic(next);
  await setImmediate();
  assert.equal(sender.track, next);
});

test("opening a late reliable channel lets the application replay current TX state", async (t) => {
  const { room } = setup(t, () => ({ peers: roster, signals: [] }), {
    onPeerReady: (id) => currentRoom.send({ tx: true }, id),
  });
  const currentRoom = room;
  await room.join();
  room.send({ tx: true }); // The channel is not open yet.
  const reliable = Connection.instances[0].channels.find(
    (channel) => channel.label === "reliable",
  )!;
  assert.deepEqual(reliable.sent, []);
  reliable.open();
  assert.deepEqual(
    reliable.sent.map((wire) => JSON.parse(wire)),
    [{ t: "d", d: { tx: true } }],
  );
});

test("closing a room drops every remote audio node once and ignores old channel callbacks", async (t) => {
  const gone: string[] = [];
  const ready: string[] = [];
  const { room } = setup(t, () => ({ peers: roster, signals: [] }), {
    onAudioGone: (id) => gone.push(id),
    onPeerReady: (id) => ready.push(id),
  });
  await room.join();
  const connection = Connection.instances[0];
  const oldOpen = connection.channels[1].onopen;
  room.close();
  room.close();
  oldOpen?.();
  assert.deepEqual(gone, ["a"]);
  assert.deepEqual(ready, []);
  assert.deepEqual(room.peerList(), []);
  assert.equal(connection.connectionState, "closed");
});

test("replacing a stale connection also removes its old audio node", async (t) => {
  let body: RtcPollResponse = { peers: roster, signals: [] };
  const gone: string[] = [];
  const { room } = setup(t, () => body, { selfId: "a", onAudioGone: (id) => gone.push(id) });
  await room.join();
  Connection.instances[0].rejectRemoteOffer = true;
  body = {
    peers: roster,
    signals: [{ id: 1, from: "z", kind: "offer", payload: { type: "offer", sdp: "a=sendrecv" } }],
  };
  await poll(room);
  assert.deepEqual(gone, ["z"]);
  assert.equal(Connection.instances.length, 2);
  assert.equal(Connection.instances[1].transceivers[0].direction, "sendrecv");
});

test("exhausting three retries notifies the UI even if the browser stays in new", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const updates: PeerInfo[][] = [];
  const { room } = setup(t, () => ({ peers: roster, signals: [] }), {
    onPeersChanged: (peers) => updates.push(peers),
  });
  await room.join();
  assert.equal(room.peerList()[0].recoveryExhausted, false);
  for (let attempt = 1; attempt <= 3; attempt++) {
    now += 11_000;
    watchdog(room);
    assert.equal(Connection.instances.length, attempt + 1);
    assert.equal(room.peerList()[0].recoveryExhausted, false);
  }
  const notifications = updates.length;
  now += 11_000;
  watchdog(room);
  assert.equal(updates.length, notifications + 1, "terminal status must reach onPeersChanged");
  assert.equal(updates.at(-1)?.[0].connectionState, "new", "preserve the real RTC state");
  assert.equal(updates.at(-1)?.[0].recoveryExhausted, true);
  now += 60_000;
  watchdog(room);
  assert.equal(Connection.instances.length, 4, "the dialer stops rebuilding after three retries");
  assert.equal(updates.length, notifications + 1, "unchanged exhaustion is reported only once");
});

test("a late connection clears exhausted recovery and gives a later outage a fresh retry budget", async (t) => {
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const updates: PeerInfo[][] = [];
  const { room } = setup(t, () => ({ peers: roster, signals: [] }), {
    selfId: "a",
    onPeersChanged: (peers) => updates.push(peers),
  });
  await room.join();
  for (let window = 0; window < 4; window++) {
    now += 11_000;
    watchdog(room);
  }
  assert.equal(Connection.instances.length, 1, "the receiver waits for the dialer's retries");
  assert.equal(updates.at(-1)?.[0].recoveryExhausted, true);

  const connection = Connection.instances[0];
  connection.connectionState = "connected";
  connection.onconnectionstatechange?.();
  assert.equal(updates.at(-1)?.[0].connectionState, "connected");
  assert.equal(updates.at(-1)?.[0].recoveryExhausted, false);

  connection.connectionState = "disconnected";
  connection.onconnectionstatechange?.();
  for (let attempt = 0; attempt < 3; attempt++) {
    now += 11_000;
    watchdog(room);
    assert.equal(room.peerList()[0].recoveryExhausted, false);
  }
  now += 11_000;
  watchdog(room);
  assert.equal(updates.at(-1)?.[0].connectionState, "disconnected");
  assert.equal(updates.at(-1)?.[0].recoveryExhausted, true);
});

test("signaling failure is reported and a later successful poll restores connectivity", async (t) => {
  let failed = true;
  const statuses: string[] = [];
  const { room } = setup(
    t,
    () => (failed ? new Response("unavailable", { status: 503 }) : { peers: [], signals: [] }),
    {
      onSignalingStatus: (status) => statuses.push(status),
    },
  );
  await room.join();
  assert.deepEqual(statuses, ["connecting", "retrying"]);
  failed = false;
  await poll(room);
  assert.deepEqual(statuses, ["connecting", "retrying", "connected"]);
});

test(
  "a stalled JSON body times out and scheduled polling retries successfully",
  { timeout: 5000 },
  async (t) => {
    const http = await streamingSignaling(t);
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const statuses: string[] = [];
    let connected!: () => void;
    const recovered = new Promise<void>((resolve) => {
      connected = resolve;
    });
    const room = new P2PRoom({
      room: "test",
      selfId: "a",
      iceServers: [],
      onSignalingStatus: (status) => {
        statuses.push(status);
        if (status === "connected") connected();
      },
    });
    t.after(() => room.close());
    const joining = room.join();
    await http.firstHeaders;
    await setImmediate();
    t.mock.timers.tick(12_000);
    await joining;
    assert.equal(http.signal()?.aborted, true);
    assert.deepEqual(statuses, ["connecting", "retrying"]);
    t.mock.timers.tick(2000);
    await recovered;
    assert.equal(http.getCount(), 2);
    assert.deepEqual(statuses, ["connecting", "retrying", "connected"]);
    room.close();
  },
);

test(
  "closing after headers aborts unfinished JSON without a late retry or connected callback",
  { timeout: 5000 },
  async (t) => {
    const http = await streamingSignaling(t);
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const statuses: string[] = [];
    const room = new P2PRoom({
      room: "test",
      selfId: "a",
      iceServers: [],
      onSignalingStatus: (status) => statuses.push(status),
    });
    t.after(() => room.close());
    const joining = room.join();
    await http.firstHeaders;
    await setImmediate();
    room.close();
    await joining;
    assert.equal(http.signal()?.aborted, true);
    t.mock.timers.tick(60_000);
    assert.equal(http.getCount(), 1);
    assert.deepEqual(statuses, ["connecting"]);
  },
);

test(
  "a normal delayed JSON body completes registration and releases its cancellation handle",
  { timeout: 5000 },
  async (t) => {
    const http = await streamingSignaling(t);
    const statuses: string[] = [];
    const room = new P2PRoom({
      room: "test",
      selfId: "a",
      iceServers: [],
      onSignalingStatus: (status) => statuses.push(status),
    });
    t.after(() => room.close());
    const joining = room.join();
    await http.firstHeaders;
    http.finishBody();
    await joining;
    assert.deepEqual(statuses, ["connecting", "connected"]);
    assert.equal(http.getCount(), 1);
    room.close();
    assert.equal(
      http.signal()?.aborted,
      false,
      "completed requests are no longer cancelled by close",
    );
  },
);

test("TURN rotation updates existing peers and restarts ICE only when credentials change", async (t) => {
  let credential = "first";
  const { room } = setup(t, () => ({
    peers: roster,
    signals: [],
    iceServers: [{ urls: "turn:relay.example:3478", username: "expires:peer", credential }],
  }));
  await room.join();
  const connection = Connection.instances[0];
  connection.connectionState = "connected";
  assert.equal(connection.configurations[0].iceServers?.at(-1)?.credential, "first");
  await poll(room);
  assert.equal(connection.restarts, 0);
  credential = "second";
  await poll(room);
  assert.equal(connection.configurations.at(-1)?.iceServers?.at(-1)?.credential, "second");
  assert.equal(connection.restarts, 1);
  await poll(room);
  assert.equal(connection.restarts, 1);
});
