import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptProtectedPayload,
  deleteLegacyClinicalStorage,
  encryptProtectedPayload,
} from "../app/protected-clinical-storage";

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
