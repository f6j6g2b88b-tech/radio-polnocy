import assert from "node:assert/strict";
import { test } from "node:test";
import { handleSignaling } from "./signaling.server.ts";

test("unconfigured serverless signaling returns an explicit 503 without starting a local DB", async () => {
  const previousVercel = process.env.VERCEL;
  const previousDatabase = process.env.DATABASE_URL;
  process.env.VERCEL = "1";
  delete process.env.DATABASE_URL;
  try {
    const response = await handleSignaling(
      new Request("https://radio.example/api/rtc?room=test&peer=a"),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "signaling database not configured",
      code: "configuration_required",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  }
});
