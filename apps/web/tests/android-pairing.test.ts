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
test("pairing and native managed settings require the same canonical origin representations", () => {
  const artifact = {version: 1, ...code(), caPem: ""};
  for (const origin of ["https://AGENCY.example", "https://agency.example:443", "https://agency.example/", "https://127.00.0.1", "https://127.0.0.1.", "https://2130706433", "https://[0:0:0:0:0:0:0:1]", "https://[::FFFF:192.0.2.1]"]) {
    assert.throws(() => parseAndroidPairing(JSON.stringify({...artifact, origin})), origin);
  }
  for (const origin of ["https://agency.example", "https://127.0.0.1:9443", "https://[::1]:9443", "https://[::ffff:c000:201]"]) {
    assert.equal(parseAndroidPairing(JSON.stringify({...artifact, origin})).origin, origin);
  }
});

test("pairing accepts the configurable lifetime and rejects expiry outside its bounds", () => {
 const now=Date.now();
 for(const minutes of [1,30,90,1440]){
 const issued={...code(),expiresAt:new Date(now+minutes*60000).toISOString()};
 assert.deepEqual(parseAndroidPairing(createAndroidPairing(issued,""),now),{version:1,...issued,caPem:""});
 }
 for(const offset of [0,-1,1440*60000+30001])assert.throws(()=>parseAndroidPairing(JSON.stringify({version:1,...code(),expiresAt:new Date(now+offset).toISOString(),caPem:""}),now));
});
