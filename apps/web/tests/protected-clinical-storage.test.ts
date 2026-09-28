import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMonotonicCiphertextRevision,
  applyProtectedAuthorityResponse,
  decryptProtectedPayload,
  deleteLegacyClinicalStorage,
  encryptProtectedPayload,
  evictionOrder,
  LatestProtectedWriteQueue,
  offlineEditingAvailable,
  persistentStorageGranted,
  protectedRecordExpired,
  summarizeProtectedPendingWork,
  retainedProtectedRecords,
  restoreProtectedRecord,
  type ProtectedClinicalRecord,
} from "../app/protected-clinical-storage";

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function record(id: string, revision: number, synchronizedRevision: number, deadline: string, updatedAt = deadline): ProtectedClinicalRecord {
  return {
    localRecordId: id, schemaVersion: 1, algorithm: "AES-256-GCM", recoveryHandle: `handle-${id}`,
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

test("staged photo bytes round-trip only inside authenticated ciphertext", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const media = "private-canonical-photo-base64";
  const payload = { schemaVersion: 1, photoQueue: [{ note: { id: "photo", persistenceState: "saved-on-device" },
    command: { canonicalBase64: media, settingsRevision: 4, effectiveAllowanceBytes: 10_000 } }] };
  const encrypted = await encryptProtectedPayload(key, "opaque-media-handle", 1, payload);
  assert.equal(new TextDecoder().decode(encrypted.ciphertext).includes(media), false);
  assert.deepEqual(await decryptProtectedPayload(key, {
    schemaVersion: 1, recoveryHandle: "opaque-media-handle", ciphertextRevision: 1, ...encrypted,
  }), payload);
});

test("audio chunks and completed recordings round-trip only inside authenticated ciphertext", async () => {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const chunk = "private-live-audio-chunk-base64";
  const completed = "private-completed-audio-base64";
  const payload = { schemaVersion: 1,
    audioPreview: { chunks: [{ sequence: 0, sourceBase64: chunk }], complete: false, interrupted: true },
    audioQueue: [{ note: { id: "audio", persistenceState: "saved-on-device" },
      command: { sourceBase64: completed, settingsRevision: 7, effectiveAllowanceBytes: 10_000 } }] };
  const encrypted = await encryptProtectedPayload(key, "opaque-audio-handle", 1, payload);
  const ciphertext = new TextDecoder().decode(encrypted.ciphertext);
  assert.equal(ciphertext.includes(chunk), false);
  assert.equal(ciphertext.includes(completed), false);
  assert.deepEqual(await decryptProtectedPayload(key, {
    schemaVersion: 1, recoveryHandle: "opaque-audio-handle", ciphertextRevision: 1, ...encrypted,
  }), payload);
});

test("protected persistence collapses an in-flight burst to one latest follow-up write", async () => {
  const first = deferred();
  const second = deferred();
  const writes: number[] = [];
  const queue = new LatestProtectedWriteQueue<number>(async (value) => {
    writes.push(value);
    await (writes.length === 1 ? first.promise : second.promise);
  });

  queue.request(1);
  queue.request(2);
  queue.request(3);
  queue.request(4);
  assert.deepEqual(writes, [1]);

  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [1, 4]);
  second.resolve();
  await queue.flush();
  assert.deepEqual(writes, [1, 4]);
});

test("completion hold snapshots prior writes, blocks later writes, and resumes only the latest payload", async () => {
  const first = deferred();
  const writes: number[] = [];
  const queue = new LatestProtectedWriteQueue<number>(async (value) => {
    writes.push(value);
    if (writes.length === 1) await first.promise;
  });

  queue.request(1);
  queue.request(2);
  const held = queue.holdAfterFlush();
  queue.request(3);
  queue.request(4);
  first.resolve();
  const release = await held;
  await queue.flush();
  assert.deepEqual(writes, [1, 2], "the completion boundary must persist only its own latest snapshot");

  release();
  await queue.flush();
  assert.deepEqual(writes, [1, 2, 4], "all changes made while held collapse to one latest write");
});

test("unchanged protected snapshots do not schedule ciphertext receipts while pending or after flush", async () => {
  const first = deferred();
  const writes: Array<{ revision: number }> = [];
  const queue = new LatestProtectedWriteQueue<{ revision: number }>(async (payload) => {
    writes.push(payload);
    await first.promise;
  }, (previous, next) => JSON.stringify(previous) === JSON.stringify(next));
  queue.request({ revision: 1 });
  queue.request({ revision: 1 });
  first.resolve();
  await queue.flush();
  queue.request({ revision: 1 });
  await queue.flush();
  assert.deepEqual(writes, [{ revision: 1 }]);

  queue.request({ revision: 2 });
  await queue.flush();
  assert.deepEqual(writes, [{ revision: 1 }, { revision: 2 }]);
});

test("deduplication retains changes made during a signing hold and retries failed unchanged writes", async () => {
  let fail = true;
  const writes: number[] = [];
  const queue = new LatestProtectedWriteQueue<number>(async (payload) => {
    writes.push(payload);
    if (fail) throw new Error("storage unavailable");
  }, Object.is);
  queue.request(1);
  await assert.rejects(queue.flush(), /storage unavailable/);
  await new Promise((resolve) => setImmediate(resolve));
  fail = false;
  queue.request(1);
  await queue.flush();
  assert.deepEqual(writes, [1, 1]);
  const release = await queue.holdAfterFlush();
  queue.request(1);
  queue.request(2);
  queue.request(2);
  await queue.flush();
  assert.deepEqual(writes, [1, 1]);
  release();
  await queue.flush();
  assert.deepEqual(writes, [1, 1, 2]);
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

test("persistent storage grant detection fails closed", async () => {
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

test("encrypted IndexedDB remains available in explicit best-effort mode", () => {
  assert.equal(offlineEditingAvailable("active"), true);
  assert.equal(offlineEditingAvailable("best-effort"), true);
  assert.equal(offlineEditingAvailable("online-only"), false);
  assert.equal(offlineEditingAvailable("read-only"), false);
  assert.equal(offlineEditingAvailable("locked"), false);
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


test("logout ignores ciphertext revision lag and UI state once report commands are synchronized", () => {
  const entry = {
    envelope: { recoveryDeadline: "2026-09-30T12:00:00.000Z" },
    revision: 12, synchronizedRevision: 10,
    payload: { schemaVersion: 1 as const, report: { queuedChanges: [] }, shellState: { view: "timeline" } },
  };
  assert.deepEqual(summarizeProtectedPendingWork([entry]), { pendingReportCount: 0, recoveryDeadline: null });
  assert.deepEqual(summarizeProtectedPendingWork([{ ...entry,
    payload: { ...entry.payload, report: { queuedChanges: [{ id: "pending-command" }] } },
  }]), { pendingReportCount: 1, recoveryDeadline: entry.envelope.recoveryDeadline });
});

test("logout still warns about pending media and previews after report commands synchronize", () => {
  type Payload = Parameters<typeof summarizeProtectedPendingWork>[0][number]["payload"];
  const summary = (media: Partial<Payload>) => summarizeProtectedPendingWork([{
    envelope: { recoveryDeadline: "2026-09-30T12:00:00.000Z" },
    payload: { schemaVersion: 1, report: { queuedChanges: [] }, ...media },
  }]);
  for (const kind of ["photoQueue", "audioQueue"] as const) {
    assert.equal(summary({ [kind]: [{ note: { persistenceState: "ready" } }] } as Partial<Payload>).pendingReportCount, 0);
    assert.equal(summary({ [kind]: [{ note: { persistenceState: "saved-on-device" } }] } as Partial<Payload>).pendingReportCount, 1);
  }
  for (const kind of ["photoPreview", "audioPreview"] as const) {
    assert.equal(summary({ [kind]: {} } as Partial<Payload>).pendingReportCount, 1);
  }
});
