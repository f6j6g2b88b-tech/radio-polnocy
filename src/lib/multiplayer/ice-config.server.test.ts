import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { needsSharedDatabase, turnIceServers } from "./ice-config.server.ts";

test("local PGlite remains available but Vercel requires a shared database", () => {
  assert.equal(needsSharedDatabase({}), false);
  assert.equal(needsSharedDatabase({ VERCEL: "1" }), true);
  assert.equal(needsSharedDatabase({ VERCEL: "true", DATABASE_URL: "  " }), true);
  assert.equal(needsSharedDatabase({ VERCEL: "1", DATABASE_URL: "postgres://configured" }), false);
});

test("TURN is optional and incomplete or non-TURN configuration is rejected", () => {
  assert.deepEqual(turnIceServers("peer", {}), []);
  assert.throws(() => turnIceServers("peer", { TURN_URLS: "turn:relay.example:3478" }));
  assert.throws(() => turnIceServers("peer", { TURN_SHARED_SECRET: "test-secret" }));
  assert.throws(() =>
    turnIceServers("peer", {
      TURN_URLS: "https://relay.example",
      TURN_SHARED_SECRET: "test-secret",
    }),
  );
});

test("TURN returns only expiring per-peer credentials, with overlap between rotations", () => {
  const env = {
    TURN_URLS: "turn:relay.example:3478, turns:relay.example:5349?transport=tcp",
    TURN_SHARED_SECRET: "test-secret",
  };
  const now = 1_700_000_000_000;
  const [server] = turnIceServers("alice", env, now);
  const expires = Number(server.username!.split(":")[0]);
  assert.ok(expires > now / 1000 + 55 * 60 - 1);
  assert.ok(expires <= now / 1000 + 60 * 60);
  assert.deepEqual(server.urls, [
    "turn:relay.example:3478",
    "turns:relay.example:5349?transport=tcp",
  ]);
  assert.equal(
    server.credential,
    createHmac("sha1", env.TURN_SHARED_SECRET).update(server.username!).digest("base64"),
  );
  assert.ok(!JSON.stringify(server).includes(env.TURN_SHARED_SECRET));
  assert.notEqual(turnIceServers("bob", env, now)[0].credential, server.credential);
  assert.notEqual(turnIceServers("alice", env, now + 5 * 60_000)[0].credential, server.credential);
  assert.deepEqual(turnIceServers("alice", env, Math.floor(now / 300_000) * 300_000 + 1000), [
    server,
  ]);
});
