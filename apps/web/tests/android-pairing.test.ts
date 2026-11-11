import assert from "node:assert/strict";
import test from "node:test";
import { createAndroidPairing, parseAndroidPairing } from "../app/android-pairing";
const code = () => ({ origin: "https://agency.example.test", token: "a".repeat(43), expiresAt: new Date(Date.now() + 240000).toISOString() });
test("pairing export round trips bounded public setup without altering the enrollment code", () => {
  const issued = code();
  assert.deepEqual(parseAndroidPairing(createAndroidPairing(issued, "")), { version: 1, ...issued, caPem: "" });
});
test("pairing rejects expired, oversized, non-HTTPS, secret-bearing and wrong-version payloads", () => {
  const valid = { version: 1, ...code(), caPem: "" };
  for (const change of [{ version: 2 }, { origin: "http://agency.example.test" }, { origin: "https://user:secret@agency.example.test" }, { origin: "https://agency.example.test/path" }, { token: "invalid" }, { expiresAt: new Date(0).toISOString() }, { caPem: "-----BEGIN PRIVATE KEY-----" }, { privateKey: "secret" }]) {
    assert.throws(() => parseAndroidPairing(JSON.stringify({ ...valid, ...change })));
  }
  assert.throws(() => parseAndroidPairing(" ".repeat(65537)));
});
