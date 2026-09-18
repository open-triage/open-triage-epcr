import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("rollout documentation states the complete protected-storage claim and its limits", async () => {
  const policy = await read("docs/protected-offline-clinical-storage.md");
  for (const required of [
    "mobile and stationary workflows",
    "queued changes",
    "incompatible recovery payloads",
    "service worker caches only",
    "dedicated offline-recovery",
    "backup",
    "rotation",
    "cleanup",
    "Monitor",
    "incident",
    "Local development",
    "static shell",
    "compromised operating system",
    "malicious browser extension",
    "active same-origin code compromise",
    "inspection of process memory",
    "never checkpointed",
    "WebAuthn device registration",
    "administrator-managed device inventory",
    "vehicle linking",
    "device revocation",
    "device decommissioning",
  ]) assert.match(policy, new RegExp(required.replaceAll(" ", "\\s+"), "i"),
    `missing rollout statement: ${required}`);
});

test("production browser rollout destroys plaintext compatibility state", async () => {
  const [compatibility, protectedStorage] = await Promise.all([
    read("docs/browser-state-compatibility.md"),
    read("apps/web/app/protected-clinical-storage.ts"),
  ]);
  assert.match(compatibility, /deletes the old encounter, per-report, synchronization/);
  assert.match(compatibility, /never imports, copies,\s+or rewrites those values/);
  assert.match(protectedStorage, /deleteLegacyClinicalStorage/);
  assert.doesNotMatch(protectedStorage, /readonly reportId\??:/,
    "the cleartext IndexedDB envelope must not label the retained report");
});

test("service-worker runtime caching is restricted to reviewed static shell resources", async () => {
  const [worker, callsController, reportsController] = await Promise.all([
    read("apps/web/service-worker/service-worker.ts"),
    read("apps/api/src/calls/assigned-calls.controller.ts"),
    read("apps/api/src/reports/draft-report.controller.ts"),
  ]);
  assert.match(worker, /isApprovedStaticRequest/);
  assert.match(worker, /\/_next\/static\//);
  assert.match(worker, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /pathname\.endsWith\("\.json"\)/);
  assert.doesNotMatch(worker, /cache\.put\(event\.request, response\.clone\(\)\)[\s\S]*origin ===/);
  assert.equal(callsController.match(/@Header\("Cache-Control", "no-store, private"\)/g)?.length, 4);
  assert.equal(reportsController.match(/@Header\("Cache-Control", "no-store, private"\)/g)?.length, 15);
});
