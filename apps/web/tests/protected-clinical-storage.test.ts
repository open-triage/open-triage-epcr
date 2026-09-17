import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMonotonicCiphertextRevision,
  applyProtectedAuthorityResponse,
  decryptProtectedPayload,
  deleteLegacyClinicalStorage,
  encryptProtectedPayload,
  evictionOrder,
  persistentStorageGranted,
  protectedRecordExpired,
  retainedProtectedRecords,
  restoreProtectedRecord,
  type ProtectedClinicalRecord,
} from "../app/protected-clinical-storage";

function record(id: string, revision: number, synchronizedRevision: number, deadline: string, updatedAt = deadline): ProtectedClinicalRecord {
  return {
    localRecordId: id, reportId: id, schemaVersion: 1, algorithm: "AES-256-GCM", recoveryHandle: `handle-${id}`,
    recoveryDeadline: deadline, ciphertextRevision: revision, synchronizedRevision, updatedAt,
    nonce: new ArrayBuffer(12), ciphertext: new ArrayBuffer(16),
  };
}

test("protected clinical payloads round-trip with a fresh 96-bit nonce for every write", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const first = await encryptProtectedPayload(key, "opaque-handle", 1, { clinical: "sensitive" });
  const second = await encryptProtectedPayload(key, "opaque-handle", 2, { clinical: "sensitive" });
  assert.equal(first.nonce.byteLength, 12);
  assert.equal(second.nonce.byteLength, 12);
  assert.notDeepEqual(new Uint8Array(first.nonce), new Uint8Array(second.nonce));
  assert.deepEqual(await decryptProtectedPayload(key, {
    schemaVersion: 1, recoveryHandle: "opaque-handle", ciphertextRevision: 1, ...first,
  }), { clinical: "sensitive" });
});

test("schema, opaque recovery handle, revision, and authentication tag are all authenticated", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const encrypted = await encryptProtectedPayload(key, "opaque-handle", 4, { clinical: "sensitive" });
  for (const changed of [
    { schemaVersion: 2, recoveryHandle: "opaque-handle", ciphertextRevision: 4 },
    { schemaVersion: 1, recoveryHandle: "swapped-handle", ciphertextRevision: 4 },
    { schemaVersion: 1, recoveryHandle: "opaque-handle", ciphertextRevision: 3 },
  ]) {
    await assert.rejects(decryptProtectedPayload(key, { ...changed, ...encrypted } as never));
  }
  const corrupted = encrypted.ciphertext.slice(0);
  const corruptedBytes = new Uint8Array(corrupted);
  corruptedBytes[0] = corruptedBytes[0]! ^ 1;
  await assert.rejects(decryptProtectedPayload(key, {
    schemaVersion: 1, recoveryHandle: "opaque-handle", ciphertextRevision: 4,
    nonce: encrypted.nonce, ciphertext: corrupted,
  }));
});

test("rollout removes every known and report-scoped plaintext clinical key without migration", () => {
  const values = new Map([
    ["open-triage:offline-reports-v1", "call number"],
    ["open-triage:standard-encounter-v1:recovery", "patient"],
    ["open-triage:standard-encounter-v1:report:report-id", "clinical"],
    ["open-triage:report-sync-v1:report-id", "Pending sync"],
    ["open-triage.clinician-session.v1", "non-clinical session"],
  ]);
  const storage = {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    removeItem(key: string) { values.delete(key); },
  } as Storage;
  deleteLegacyClinicalStorage(storage);
  assert.deepEqual([...values.keys()], ["open-triage.clinician-session.v1"]);
});

test("stale and swapped atomic replacements are rejected before the last ciphertext is touched", () => {
  const current = record("report", 8, 7, "2026-09-19T00:00:00.000Z");
  assert.throws(() => assertMonotonicCiphertextRevision(current, { recoveryHandle: current.recoveryHandle, ciphertextRevision: 8 }), /newer/);
  assert.throws(() => assertMonotonicCiphertextRevision(current, { recoveryHandle: "swapped", ciphertextRevision: 9 }), /locked/);
  assert.doesNotThrow(() => assertMonotonicCiphertextRevision(current, { recoveryHandle: current.recoveryHandle, ciphertextRevision: 9 }));
});

test("offline capability is enabled only after persistent storage is confirmed", async () => {
  assert.equal(await persistentStorageGranted(undefined), false);
  assert.equal(await persistentStorageGranted({ persisted: async () => false, persist: async () => false }), false);
  assert.equal(await persistentStorageGranted({ persisted: async () => { throw new Error("blocked"); }, persist: async () => true }), false);
  let checks = 0;
  assert.equal(await persistentStorageGranted({
    persisted: async () => ++checks > 1,
    persist: async () => true,
  }), true);
  assert.equal(checks, 2);
});

test("quota pressure chooses expired then synchronized ciphertext and never unsynchronized work", () => {
  const records = [
    record("unsynchronized-expired", 9, 8, "2026-09-16T00:00:00.000Z"),
    record("synchronized-current", 5, 5, "2026-09-20T00:00:00.000Z", "2026-09-15T00:00:00.000Z"),
    record("expired", 3, 3, "2026-09-16T00:00:00.000Z"),
    record("active", 2, 2, "2026-09-22T00:00:00.000Z", "2026-09-17T00:00:00.000Z"),
  ];
  assert.deepEqual(evictionOrder(records, new Date("2026-09-17T00:00:00.000Z")).map(({ localRecordId }) => localRecordId), ["expired", "synchronized-current", "active"]);
});

test("logout retention keeps only unexpired unsynchronized ciphertext without extending its deadline", () => {
  const records = [
    record("pending", 9, 8, "2026-09-18T12:00:00.000Z"),
    record("synchronized", 5, 5, "2026-09-20T00:00:00.000Z"),
    record("expired-pending", 3, 2, "2026-09-17T12:00:00.000Z"),
  ];
  const retained = retainedProtectedRecords(records, new Date("2026-09-17T12:00:00.000Z"));
  assert.deepEqual(retained.map(({ localRecordId }) => localRecordId), ["pending"]);
  assert.equal(retained[0]!.recoveryDeadline, "2026-09-18T12:00:00.000Z");
  assert.equal(retained[0], records[0]);
});

test("corruption and incompatible payloads stay locked in their original authenticated envelope", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const encrypted = await encryptProtectedPayload(key, "handle", 2, { schemaVersion: 99 });
  const original: ProtectedClinicalRecord = {
    localRecordId: "report", schemaVersion: 1, algorithm: "AES-256-GCM", recoveryHandle: "handle",
    recoveryDeadline: "2026-09-19T00:00:00.000Z", ciphertextRevision: 2, synchronizedRevision: 1,
    updatedAt: "2026-09-17T00:00:00.000Z", ...encrypted,
  };
  assert.equal((await restoreProtectedRecord(key, original, "handle", (payload): payload is { schemaVersion: 1 } =>
    !!payload && typeof payload === "object" && (payload as { schemaVersion?: unknown }).schemaVersion === 1)).status, "incompatible");
  assert.equal((await restoreProtectedRecord(key, original, "another-handle", (_payload): _payload is unknown => true)).status, "locked");
  const corrupted = { ...original, ciphertext: original.ciphertext.slice(0) };
  const corruptedBytes = new Uint8Array(corrupted.ciphertext);
  corruptedBytes[0] = corruptedBytes[0]! ^ 1;
  assert.equal((await restoreProtectedRecord(key, corrupted, "handle", (_payload): _payload is unknown => true)).status, "locked");
  assert.equal(original.localRecordId, "report");
  assert.equal(original.ciphertextRevision, 2);
});

test("expiry cleanup decides from opaque deadline metadata without decrypting ciphertext", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  assert.equal(protectedRecordExpired({ recoveryDeadline: "2026-09-17T11:59:59.999Z" }, now), true);
  assert.equal(protectedRecordExpired({ recoveryDeadline: "2026-09-17T12:00:00.000Z" }, now), true);
  assert.equal(protectedRecordExpired({ recoveryDeadline: "2026-09-17T12:00:00.001Z" }, now), false);
  assert.equal(protectedRecordExpired({ recoveryDeadline: "not-a-timestamp" }, now), true);
});

test("only an explicit server authorization denial is treated as a clinical lock signal", () => {
  assert.equal(applyProtectedAuthorityResponse("opaque-report", { status: 401 }), true);
  assert.equal(applyProtectedAuthorityResponse("opaque-report", { status: 403 }), true);
  assert.equal(applyProtectedAuthorityResponse("opaque-report", { status: 404 }), false);
  assert.equal(applyProtectedAuthorityResponse("opaque-report", { status: 503 }), false);
});
