import ts from "typescript";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertClinicalRouteCacheHeaders } from "./helpers/clinical-route-cache-headers.mjs";

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
  assertOpaqueProtectedEnvelope(protectedStorage);
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
  assertClinicalRouteCacheHeaders(callsController, "assigned-calls.controller.ts");
  assertClinicalRouteCacheHeaders(reportsController, "draft-report.controller.ts");
});


test("clinical cache protection rejects one missing route header and accepts additional protected routes", () => {
  const header = '@Header("Cache-Control", "no-store, private")';
  const fixture = `import { Controller, Get, Post as Submit, Delete, Header } from "@nestjs/common";
    @Controller("clinical") class ClinicalController {
      @Get("existing") ${header} read() {}
      @Submit("new") ${header} create() {}
    }`;
  assert.equal(assertClinicalRouteCacheHeaders(fixture).length, 2);
  assert.throws(() => assertClinicalRouteCacheHeaders(fixture.replace(header, "")), /ClinicalController\.read.*no-store|no-store.*ClinicalController\.read/);
  const expanded = fixture.replace(/}\s*$/, `@Delete("attempt") ${header} cancel() {} }`);
  assert.equal(assertClinicalRouteCacheHeaders(expanded).length, 3, "new protected routes need no count update");
  assert.throws(() => assertClinicalRouteCacheHeaders(expanded.replace(header, `// ${header}\n`)), /ClinicalController\.read/,
    "a header in a comment cannot protect a route");
});


function assertOpaqueProtectedEnvelope(source) {
  const parsed = ts.createSourceFile("storage.ts", source, ts.ScriptTarget.Latest, true);
  const envelope = parsed.statements.find(statement => ts.isInterfaceDeclaration(statement) && statement.name.text === "ProtectedClinicalRecord");
  assert.ok(envelope, "protected envelope must be declared explicitly");
  const allowed = new Set(["localRecordId", "schemaVersion", "algorithm", "recoveryHandle", "checkpointScope", "recoveryDeadline", "ciphertextRevision", "synchronizedRevision", "updatedAt", "nonce", "ciphertext"]);
  for (const member of envelope.members) assert.ok(member.name && allowed.has(member.name.getText(parsed)),
    "the cleartext IndexedDB envelope must contain only reviewed opaque metadata");
}

test("envelope guard distinguishes encrypted payload identity from cleartext clinical labels", () => {
  const source = 'interface ProtectedClinicalRecord { readonly ciphertext: ArrayBuffer; } interface EncryptedPayload { readonly reportId: string; readonly patientId: string; }';
  assertOpaqueProtectedEnvelope(source);
  for (const field of ["reportId", "patientId", "organizationId", "userId", "summary"]) {
    assert.throws(() => assertOpaqueProtectedEnvelope(source.replace('readonly ciphertext', `readonly ${field}: string; readonly ciphertext`)), /opaque metadata/);
  }
});
