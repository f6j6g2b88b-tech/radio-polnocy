import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSign, waveChannel } from "./shortwave-controls.ts";

test("signs entered with spaces or separators share one canonical room", () => {
  assert.equal(normalizeSign(" ab-12 "), "AB12");
  assert.equal(normalizeSign("Ab12"), normalizeSign("ab 12"));
  assert.equal(normalizeSign("ab12-other"), "AB12");
  assert.equal(normalizeSign("--"), "");
});

test("frequency input selects a bounded 10 kHz conversation channel", () => {
  assert.equal(waveChannel(6004), 6000);
  assert.equal(waveChannel(6005), 6010);
  assert.equal(waveChannel(2990), 3000);
  assert.equal(waveChannel(12030), 12000);
});
