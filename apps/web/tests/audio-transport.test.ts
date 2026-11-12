import assert from "node:assert/strict";
import test from "node:test";
import { fetchReportAudio } from "../app/report-audio-api";
import { expectedApiUrl } from "./helpers/api-url";

test("audio locations cannot forward credentials to another origin, traversal or non-API resource", async () => {
  for (const location of ["https://attacker.test/api/audio", "//attacker.test/api/audio", "/outside", "/api/../outside",
    "/api/%2e%2e/outside", "/api/%2e%2e%2foutside", "/api/audio#secret", "/api/\\attacker", "/api/%bad%escape"]) {
    await assert.rejects(fetchReportAudio("report", "note", location), /Unapproved audio location/);
  }
});

test("authorized audio rejects redirects and preserves exact binary canonical bytes", async () => {
  const original = global.fetch;
  const bytes = Uint8Array.of(0, 0, 0, 24, 102, 116, 121, 112, 77, 52, 65, 32, 128, 255, 0, 254);
  global.fetch = async (input, init) => {
    assert.equal(input, expectedApiUrl("/api/reports/report/audio/note/content"));
    assert.equal(init?.redirect, "error");
    return new Response(bytes, { headers: { "content-type": "audio/mp4" } });
  };
  try { assert.deepEqual(new Uint8Array(await (await fetchReportAudio("report", "note")).arrayBuffer()), bytes); }
  finally { global.fetch = original; }
});

test("audio playback does not accept a credentialed redirect or a noncanonical response", async () => {
  const original = global.fetch;
  try {
    global.fetch = async (_input, init) => { assert.equal(init?.redirect, "error"); throw new TypeError("Redirect blocked"); };
    await assert.rejects(fetchReportAudio("report", "note"), /Redirect blocked/);
    global.fetch = async () => new Response("html", { headers: { "content-type": "text/html" } });
    await assert.rejects(fetchReportAudio("report", "note"), /not canonical M4A/);
  } finally { global.fetch = original; }
});
