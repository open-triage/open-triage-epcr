import type { ProtectedCiphertextReceipt, ProtectedReportKeyEnvelope } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export const PROTECTED_CLINICAL_DATABASE = "open-triage-protected-clinical-v1";
export const PROTECTED_CLINICAL_STORE = "encrypted-reports";
export const PROTECTED_ENVELOPE_SCHEMA = 1 as const;

export interface ProtectedClinicalRecord {
  readonly localRecordId: string;
  readonly reportId?: string;
  readonly schemaVersion: 1;
  readonly algorithm: "AES-256-GCM";
  readonly recoveryHandle: string;
  readonly recoveryDeadline: string;
  readonly ciphertextRevision: number;
  readonly synchronizedRevision: number;
  readonly updatedAt: string;
  readonly nonce: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
}

type ProtectedClinicalPayload = { readonly schemaVersion: 1; readonly report?: unknown; readonly shellState?: unknown };
export type ProtectedStorageMode = "active" | "online-only" | "read-only" | "locked";
export interface ProtectedStorageStatus { readonly mode: ProtectedStorageMode; readonly explanation: string | null }
export interface ProtectedLogoutSummary {
  readonly pendingReportCount: number;
  readonly recoveryDeadline: string | null;
}

export function protectedRecordExpired(
  record: Pick<ProtectedClinicalRecord, "recoveryDeadline">,
  now = new Date(),
): boolean {
  const deadline = Date.parse(record.recoveryDeadline);
  return !Number.isFinite(deadline) || deadline <= now.getTime();
}

type RuntimeContext = {
  readonly key: CryptoKey;
  readonly localRecordId: string;
  envelope: ProtectedReportKeyEnvelope;
  readonly releaseLock: () => void;
  readonly csrfToken: string;
  payload: ProtectedClinicalPayload;
  revision: number;
  synchronizedRevision: number;
  pending: Promise<void>;
  failure: Error | null;
  locking: boolean;
  receiptRequest: AbortController | null;
};

export type RecoveredProtectedPayload = {
  readonly schemaVersion: 1;
  readonly report?: unknown;
  readonly shellState?: unknown;
};

export class RecoveryReauthenticationRequiredError extends Error {
  constructor() {
    super("Confirm your password to recover this protected report.");
    this.name = "RecoveryReauthenticationRequiredError";
  }
}

const contexts = new Map<string, RuntimeContext>();
const statuses = new Map<string, ProtectedStorageStatus>();
const statusListeners = new Set<(reportId: string, status: ProtectedStorageStatus) => void>();
const DEFAULT_STORAGE_STATUS: ProtectedStorageStatus = {
  mode: "online-only",
  explanation: "Offline editing is unavailable until protected persistent storage is prepared.",
};

function payloadHasPendingWork(payload: ProtectedClinicalPayload): boolean {
  const report = payload.report as { queuedChanges?: unknown } | undefined;
  return Array.isArray(report?.queuedChanges) && report.queuedChanges.length > 0;
}

/** Only active-session state is inspected; locked records are deliberately undiscoverable. */
export function protectedLogoutSummary(): ProtectedLogoutSummary {
  const pending = [...contexts.values()].filter((context) =>
    context.synchronizedRevision < context.revision || payloadHasPendingWork(context.payload));
  return {
    pendingReportCount: pending.length,
    recoveryDeadline: pending.map(({ envelope }) => envelope.recoveryDeadline).sort()[0] ?? null,
  };
}

function publishStatus(reportId: string, status: ProtectedStorageStatus): void {
  statuses.set(reportId, status);
  statusListeners.forEach((listener) => listener(reportId, status));
}

export function protectedStorageStatus(reportId: string): ProtectedStorageStatus {
  return statuses.get(reportId) ?? DEFAULT_STORAGE_STATUS;
}

export function subscribeProtectedStorageStatus(listener: (reportId: string, status: ProtectedStorageStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function associatedData(recoveryHandle: string, ciphertextRevision: number): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ schemaVersion: PROTECTED_ENVELOPE_SCHEMA, recoveryHandle, ciphertextRevision })).buffer as ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROTECTED_CLINICAL_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROTECTED_CLINICAL_STORE)) database.createObjectStore(PROTECTED_CLINICAL_STORE, { keyPath: "localRecordId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Protected clinical storage could not be opened"));
    request.onblocked = () => reject(new Error("Protected clinical storage is blocked by another browser tab"));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Protected clinical storage request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Protected clinical transaction was aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("Protected clinical transaction failed"));
  });
}

export function assertMonotonicCiphertextRevision(
  current: Pick<ProtectedClinicalRecord, "ciphertextRevision" | "recoveryHandle"> | undefined,
  replacement: Pick<ProtectedClinicalRecord, "ciphertextRevision" | "recoveryHandle">,
): void {
  if (current?.recoveryHandle !== undefined && current.recoveryHandle !== replacement.recoveryHandle) throw new Error("Protected envelope identity changed; the record is locked");
  if (current && replacement.ciphertextRevision <= current.ciphertextRevision) throw new Error("A newer protected ciphertext revision already exists");
}

async function storeRecord(record: ProtectedClinicalRecord): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(PROTECTED_CLINICAL_STORE);
    const current = await requestResult(store.get(record.localRecordId)) as ProtectedClinicalRecord | undefined;
    assertMonotonicCiphertextRevision(current, record);
    store.put(record);
    await transactionComplete(transaction);
  } finally { database.close(); }
}

async function allRecords(): Promise<ProtectedClinicalRecord[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readonly");
    const records = await requestResult(transaction.objectStore(PROTECTED_CLINICAL_STORE).getAll());
    await transactionComplete(transaction);
    return records as ProtectedClinicalRecord[];
  } finally { database.close(); }
}

async function deleteRecords(localRecordIds: ReadonlyArray<string>): Promise<void> {
  if (!localRecordIds.length) return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(PROTECTED_CLINICAL_STORE);
    localRecordIds.forEach((id) => store.delete(id));
    await transactionComplete(transaction);
  } finally { database.close(); }
}

export function retainedProtectedRecords(
  records: ReadonlyArray<ProtectedClinicalRecord>,
  now = new Date(),
): ProtectedClinicalRecord[] {
  return records.filter((record) =>
    record.synchronizedRevision < record.ciphertextRevision && !protectedRecordExpired(record, now));
}

/**
 * Ends readable access before changing browser identity. Pending writes settle
 * first, then all keys/decrypted payloads and disposable ciphertext are removed.
 */
export async function lockProtectedClinicalStorage(now = new Date()): Promise<void> {
  const active = [...contexts.entries()];
  for (const [, context] of active) {
    context.locking = true;
    context.receiptRequest?.abort();
  }
  await Promise.allSettled(active.map(([, context]) => context.pending));
  for (const [reportId, context] of active) {
    contexts.delete(reportId);
    statuses.delete(reportId);
    context.payload = { schemaVersion: PROTECTED_ENVELOPE_SCHEMA };
    context.releaseLock();
  }
  if (!("indexedDB" in globalThis)) return;
  const records = await allRecords();
  const retainedIds = new Set(retainedProtectedRecords(records, now).map(({ localRecordId }) => localRecordId));
  await deleteRecords(records.filter(({ localRecordId }) => !retainedIds.has(localRecordId)).map(({ localRecordId }) => localRecordId));
}

async function deleteRecordsForReport(reportId: string): Promise<void> {
  const matching = (await allRecords()).filter((record) => record.reportId === reportId);
  await deleteRecords(matching.map(({ localRecordId }) => localRecordId));
}

export function evictionOrder(records: ReadonlyArray<ProtectedClinicalRecord>, now = new Date(), excludedLocalRecordId?: string): ProtectedClinicalRecord[] {
  const candidates = records.filter((record) => record.localRecordId !== excludedLocalRecordId && record.synchronizedRevision >= record.ciphertextRevision);
  const expired = candidates.filter((record) => Date.parse(record.recoveryDeadline) <= now.getTime())
    .sort((left, right) => left.recoveryDeadline.localeCompare(right.recoveryDeadline));
  const expiredIds = new Set(expired.map((record) => record.localRecordId));
  return [...expired, ...candidates.filter((record) => !expiredIds.has(record.localRecordId)).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))];
}

function quotaError(error: unknown): boolean { return error instanceof DOMException && error.name === "QuotaExceededError"; }

async function storeWithPressureRecovery(record: ProtectedClinicalRecord): Promise<void> {
  try { await storeRecord(record); return; } catch (error) { if (!quotaError(error)) throw error; }
  for (const candidate of evictionOrder(await allRecords(), new Date(), record.localRecordId)) {
    await deleteRecords([candidate.localRecordId]);
    try { await storeRecord(record); return; } catch (error) { if (!quotaError(error)) throw error; }
  }
  throw new DOMException("Protected storage quota is exhausted; unsynchronized ciphertext was retained", "QuotaExceededError");
}

/** Removes expired ciphertext and its opaque metadata without loading a key or decrypting. */
export async function deleteExpiredProtectedRecords(now = new Date()): Promise<number> {
  if (!("indexedDB" in globalThis)) return 0;
  const database = await openDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      let removed = 0;
      const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readwrite");
      const request = transaction.objectStore(PROTECTED_CLINICAL_STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const record = cursor.value as Partial<ProtectedClinicalRecord>;
        if (typeof record.recoveryDeadline !== "string" ||
            protectedRecordExpired(record as Pick<ProtectedClinicalRecord, "recoveryDeadline">, now)) {
          cursor.delete();
          removed += 1;
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(removed);
      transaction.onabort = () => reject(transaction.error ?? new Error("Protected clinical cleanup was aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Protected clinical cleanup failed"));
    });
  } finally {
    database.close();
  }
}

function ciphertextSha256(ciphertext: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest("SHA-256", ciphertext).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""));
}

async function updateRecordDeadline(localRecordId: string, ciphertextRevision: number, recoveryDeadline: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readwrite", { durability: "strict" });
    const store = transaction.objectStore(PROTECTED_CLINICAL_STORE);
    const current = await requestResult(store.get(localRecordId)) as ProtectedClinicalRecord | undefined;
    if (current?.ciphertextRevision === ciphertextRevision) store.put({ ...current, recoveryDeadline });
    await transactionComplete(transaction);
  } finally { database.close(); }
}

async function recordForRecoveryHandle(recoveryHandle: string): Promise<ProtectedClinicalRecord | null> {
  return (await allRecords()).find((record) => record.recoveryHandle === recoveryHandle) ?? null;
}

export async function encryptProtectedPayload(
  key: CryptoKey,
  recoveryHandle: string,
  ciphertextRevision: number,
  payload: unknown,
): Promise<Pick<ProtectedClinicalRecord, "nonce" | "ciphertext">> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: associatedData(recoveryHandle, ciphertextRevision), tagLength: 128 }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { nonce: nonce.buffer.slice(0), ciphertext };
}

export async function decryptProtectedPayload(key: CryptoKey, record: Pick<ProtectedClinicalRecord, "schemaVersion" | "recoveryHandle" | "ciphertextRevision" | "nonce" | "ciphertext">): Promise<unknown> {
  if (record.schemaVersion !== PROTECTED_ENVELOPE_SCHEMA) throw new Error("Unsupported protected envelope schema");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: record.nonce, additionalData: associatedData(record.recoveryHandle, record.ciphertextRevision), tagLength: 128 }, key, record.ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

export type ProtectedRecordRestoreResult<T> = { readonly status: "ready"; readonly payload: T } | { readonly status: "locked" | "incompatible"; readonly reason: string };

/** Authentication and compatibility checks are read-only: the original ciphertext stays at its key. */
export async function restoreProtectedRecord<T>(key: CryptoKey, record: ProtectedClinicalRecord, expectedRecoveryHandle: string, accepts: (payload: unknown) => payload is T): Promise<ProtectedRecordRestoreResult<T>> {
  if (record.recoveryHandle !== expectedRecoveryHandle) return { status: "locked", reason: "The protected envelope does not belong to this report." };
  let payload: unknown;
  try { payload = await decryptProtectedPayload(key, record); }
  catch { return { status: "locked", reason: "Protected clinical data failed authentication and was not opened." }; }
  return accepts(payload)
    ? { status: "ready", payload }
    : { status: "incompatible", reason: "Protected clinical data was preserved in its original authenticated envelope." };
}

async function persist(reportId: string): Promise<void> {
  const context = contexts.get(reportId);
  if (!context) return;
  const revision = context.revision + 1;
  const encrypted = await encryptProtectedPayload(context.key, context.envelope.recoveryHandle, revision, structuredClone(context.payload));
  const record: ProtectedClinicalRecord = {
    localRecordId: context.localRecordId, reportId, schemaVersion: PROTECTED_ENVELOPE_SCHEMA, algorithm: "AES-256-GCM",
    recoveryHandle: context.envelope.recoveryHandle, recoveryDeadline: context.envelope.recoveryDeadline,
    ciphertextRevision: revision, synchronizedRevision: Math.min(context.synchronizedRevision, revision), updatedAt: new Date().toISOString(), ...encrypted,
  };
  await storeWithPressureRecovery(record);

  const url = apiRequestUrl(`/api/reports/${reportId}/protected-ciphertext-receipt`);
  if (url && navigator.onLine && !context.locking) {
    const receiptRequest = new AbortController();
    context.receiptRequest = receiptRequest;
    let response: Response;
    try {
      response = await fetch(url, browserRequestInit({
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": context.csrfToken },
        body: JSON.stringify({
          schemaVersion: 1,
          recoveryHandle: context.envelope.recoveryHandle,
          ciphertextRevision: revision,
          ciphertextSha256: await ciphertextSha256(encrypted.ciphertext),
        }),
        signal: receiptRequest.signal,
      }));
    } finally {
      if (context.receiptRequest === receiptRequest) context.receiptRequest = null;
    }
    if (applyProtectedAuthorityResponse(reportId, response)) {
      throw new Error("Clinical authorization changed; protected editing is locked");
    }
    if (response.status === 404 || response.status === 410) {
      contexts.delete(reportId);
      statuses.delete(reportId);
      context.releaseLock();
      await deleteRecords([context.localRecordId]);
      throw new Error("Protected report recovery is unavailable");
    }
    if (!response.ok) throw new Error("Protected ciphertext receipt could not be recorded");
    const receipt = await response.json() as ProtectedCiphertextReceipt;
    context.envelope = { ...context.envelope, recoveryDeadline: receipt.recoveryDeadline };
    await updateRecordDeadline(context.localRecordId, revision, receipt.recoveryDeadline);
  }
  context.revision = revision;
  context.failure = null;
  publishStatus(reportId, { mode: "active", explanation: null });
  if (context.synchronizedRevision >= revision) void checkpointProtectedCiphertext(reportId, context, revision, encrypted.ciphertext);
}

async function checkpointProtectedCiphertext(reportId: string, context: RuntimeContext, revision: number, ciphertext: ArrayBuffer): Promise<void> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", ciphertext));
  const ciphertextSha256 = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const url = apiRequestUrl(`/api/reports/${reportId}/protected-ciphertext-checkpoint`);
  if (!url || context.locking) return;
  try {
    const response = await fetch(url, browserRequestInit({
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": context.csrfToken },
      body: JSON.stringify({ schemaVersion: 1, recoveryHandle: context.envelope.recoveryHandle, ciphertextRevision: revision, ciphertextSha256 }),
    }));
    if (applyProtectedAuthorityResponse(reportId, response)) return;
    if (response.status === 409) publishStatus(reportId, { mode: "locked", explanation: "A newer synchronized protected revision exists. This tab is locked against rollback." });
  } catch { /* The local authenticated ciphertext remains authoritative until reconnect. */ }
}

function queuePersist(reportId: string): Promise<void> {
  const context = contexts.get(reportId);
  if (!context) return Promise.resolve();
  context.pending = context.pending.catch(() => undefined).then(() => persist(reportId)).catch((error: unknown) => {
    context.failure = error instanceof Error ? error : new Error("Protected clinical persistence failed");
    if (contexts.get(reportId) !== context) throw context.failure;
    publishStatus(reportId, {
      mode: navigator.onLine ? "online-only" : "read-only",
      explanation: navigator.onLine
        ? "This browser cannot preserve offline changes. Server saves remain available while connected."
        : "Protected storage failed while offline. The current form is readable, but editing is paused until storage or connectivity recovers.",
    });
    throw context.failure;
  });
  return context.pending;
}

export async function persistentStorageGranted(
  storage: Pick<StorageManager, "persist" | "persisted"> | undefined = typeof navigator === "undefined" ? undefined : navigator.storage,
): Promise<boolean> {
  if (!storage?.persisted || !storage.persist) return false;
  try {
    if (await storage.persisted()) return true;
    if (!(await storage.persist())) return false;
    return storage.persisted();
  } catch { return false; }
}

async function acquireEditLock(reportId: string): Promise<(() => void) | null> {
  if (!navigator.locks?.request) return null;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let announce!: (value: boolean) => void;
  const acquired = new Promise<boolean>((resolve) => { announce = resolve; });
  void navigator.locks.request(`open-triage:report:${reportId}`, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    announce(lock !== null);
    if (lock) await held;
  });
  return (await acquired) ? release : null;
}

export function protectedStorageActive(reportId: string): boolean { return contexts.has(reportId) && protectedStorageStatus(reportId).mode === "active"; }

/**
 * Applies a server authority decision without probing local ciphertext. A
 * denial drops the only readable key reference immediately and leaves the
 * opaque record to its existing recovery deadline.
 */
export function applyProtectedAuthorityResponse(reportId: string,
  response: Pick<Response, "status">): boolean {
  if (response.status !== 401 && response.status !== 403) return false;
  const context = contexts.get(reportId);
  if (!context) return true;
  context.locking = true;
  context.receiptRequest?.abort();
  contexts.delete(reportId);
  context.payload = { schemaVersion: PROTECTED_ENVELOPE_SCHEMA };
  context.releaseLock();
  publishStatus(reportId, {
    mode: "locked",
    explanation: "Clinical authorization changed. Protected work is locked until server access is restored before its existing deadline.",
  });
  return true;
}

export async function prepareProtectedReport(csrfToken: string, reportId: string): Promise<boolean> {
  if (browserRequestConfiguration().mode !== "server") return false;
  if (contexts.has(reportId)) return true;
  if (!("indexedDB" in globalThis) || !globalThis.crypto?.subtle || !navigator.locks?.request || !(await persistentStorageGranted())) {
    publishStatus(reportId, { mode: "online-only", explanation: "Offline editing is unavailable because this browser did not grant persistent protected storage." });
    return false;
  }
  const releaseLock = await acquireEditLock(reportId);
  if (!releaseLock) {
    publishStatus(reportId, { mode: "read-only", explanation: "This report is already open for editing in another browser tab." });
    return false;
  }
  try {
    const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", generated));
    const recoveryHandle = crypto.randomUUID();
    const url = apiRequestUrl(`/api/reports/${reportId}/protected-key-envelope`);
    if (!url) { raw.fill(0); releaseLock(); return false; }
    const response = await fetch(url, browserRequestInit({ method: "POST", headers: { "content-type": "application/json", "x-csrf-token": csrfToken }, body: JSON.stringify({ schemaVersion: 1, recoveryHandle, reportKeyBase64: bytesToBase64(raw) }) }));
    if (!response.ok) {
      raw.fill(0);
      if (response.status === 409) {
        releaseLock();
        publishStatus(reportId, { mode: "online-only", explanation: "Protected recovery belongs to another browser profile; connected server saves remain available." });
        return false;
      }
      throw new Error(response.status === 401 ? "Your shift session has ended." : "Protected offline storage could not be prepared.");
    }
    const envelope = await response.json() as ProtectedReportKeyEnvelope;
    const key = await crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    raw.fill(0);
    contexts.set(reportId, { key, localRecordId: crypto.randomUUID(), envelope, csrfToken, payload: { schemaVersion: PROTECTED_ENVELOPE_SCHEMA }, revision: 0, synchronizedRevision: 0, pending: Promise.resolve(), failure: null, locking: false, receiptRequest: null, releaseLock });
    publishStatus(reportId, { mode: "active", explanation: null });
    return true;
  } catch (error) {
    releaseLock();
    publishStatus(reportId, { mode: "online-only", explanation: "Protected offline storage could not be prepared; connected server saves remain available." });
    throw error;
  }
}

export async function recoverProtectedReport(
  csrfToken: string,
  reportId: string,
): Promise<RecoveredProtectedPayload | null> {
  if (browserRequestConfiguration().mode !== "server" || contexts.has(reportId) ||
      !("indexedDB" in globalThis) || !globalThis.crypto?.subtle || !navigator.locks?.request ||
      !(await persistentStorageGranted())) return null;
  const createUrl = apiRequestUrl(`/api/reports/${reportId}/recovery-grants`);
  if (!createUrl) return null;
  const grantResponse = await fetch(createUrl, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ schemaVersion: 1, envelopeVersion: 1 }),
  }));
  if (grantResponse.status === 428) throw new RecoveryReauthenticationRequiredError();
  if (grantResponse.status === 404 || grantResponse.status === 410) {
    await deleteRecordsForReport(reportId);
    return null;
  }
  if (!grantResponse.ok) throw new Error(grantResponse.status === 401
    ? "Your shift session has ended." : "Protected report recovery is unavailable.");
  const grant = await grantResponse.json() as {
    schemaVersion: 1; envelopeVersion: 1; recoveryHandle: string; grant: string; expiresAt: string;
    reportStatus: "draft" | "signed";
  };
  const record = await recordForRecoveryHandle(grant.recoveryHandle);
  if (!record || record.schemaVersion !== 1 || record.algorithm !== "AES-256-GCM" ||
      Date.parse(record.recoveryDeadline) <= Date.now() || Date.parse(grant.expiresAt) <= Date.now()) return null;

  const releaseLock = await acquireEditLock(reportId);
  if (!releaseLock) {
    publishStatus(reportId, { mode: "read-only", explanation: "This report is already open for editing in another browser tab." });
    return null;
  }
  let activated = false;
  let raw: Uint8Array | undefined;
  try {

    const consumeUrl = apiRequestUrl(`/api/reports/${reportId}/recovery-grants/consume`);
    if (!consumeUrl) return null;
    const consumeResponse = await fetch(consumeUrl, browserRequestInit({
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
      body: JSON.stringify({ schemaVersion: 1, envelopeVersion: grant.envelopeVersion, grant: grant.grant }),
    }));
    if (!consumeResponse.ok) throw new Error(consumeResponse.status === 401
      ? "Your shift session has ended." : "Protected report recovery is unavailable.");
    const recovered = await consumeResponse.json() as { reportKeyBase64: string; wrappingKeyVersion: number };
    raw = Uint8Array.from(atob(recovered.reportKeyBase64), (character) => character.charCodeAt(0));
    if (raw.byteLength !== 32) throw new Error("Protected report recovery is unavailable.");
    const key = await crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    const payload = await decryptProtectedPayload(key, record);
    if (!payload || typeof payload !== "object" || (payload as { schemaVersion?: unknown }).schemaVersion !== 1) {
      throw new Error("Protected report recovery is unavailable.");
    }
    const protectedPayload = payload as RecoveredProtectedPayload;
    const recoveredReportId = (protectedPayload.report as { report?: { id?: unknown } } | undefined)?.report?.id;
    if (recoveredReportId !== undefined && recoveredReportId !== reportId) {
      throw new Error("Protected report recovery is unavailable.");
    }
    contexts.set(reportId, {
      key,
      localRecordId: record.localRecordId,
      envelope: { schemaVersion: 1, recoveryHandle: record.recoveryHandle,
        recoveryDeadline: record.recoveryDeadline, wrappingKeyVersion: recovered.wrappingKeyVersion },
      csrfToken,
      releaseLock,
      payload: protectedPayload,
      revision: record.ciphertextRevision,
      synchronizedRevision: record.synchronizedRevision,
      pending: Promise.resolve(),
      failure: null,
      locking: false,
      receiptRequest: null,
    });
    activated = true;
    publishStatus(reportId, grant.reportStatus === "signed"
      ? { mode: "locked", explanation: "This report was completed elsewhere. Pending work will be submitted as a late-work audit note." }
      : { mode: "active", explanation: null });
    return protectedPayload;
  } finally {
    raw?.fill(0);
    if (!activated) releaseLock();
  }
}

export function updateProtectedReport(reportId: string, report: unknown): void {
  const context = contexts.get(reportId);
  if (!context) return;
  context.payload = { ...context.payload, report };
  const candidate = report as { queuedChanges?: ReadonlyArray<unknown> } | null;
  if (candidate && Array.isArray(candidate.queuedChanges) && candidate.queuedChanges.length === 0) context.synchronizedRevision = context.revision + 1;
  void queuePersist(reportId).catch(() => undefined);
}

export function updateProtectedShellState(reportId: string, shellState: unknown): void {
  const context = contexts.get(reportId);
  if (!context) return;
  context.payload = { ...context.payload, shellState };
  void queuePersist(reportId).catch(() => undefined);
}

export function protectedShellState(reportId: string): unknown { return contexts.get(reportId)?.payload.shellState; }

export async function flushProtectedReport(reportId: string): Promise<void> {
  const context = contexts.get(reportId);
  await context?.pending;
  if (context?.failure) throw context.failure;
}

export function removeProtectedReport(reportId: string): void {
  const context = contexts.get(reportId);
  if (!context) return;
  contexts.delete(reportId);
  statuses.delete(reportId);
  context.releaseLock();
  void context.pending.catch(() => undefined).then(() => deleteRecords([context.localRecordId])).catch(() => undefined);
}

/** Locks editing immediately while retaining the key until queued late work is acknowledged. */
export function markProtectedReportCompleted(reportId: string): void {
  if (!contexts.has(reportId)) return;
  publishStatus(reportId, {
    mode: "locked",
    explanation: "This report was completed elsewhere. Pending work will be submitted as a late-work audit note.",
  });
}

export const LEGACY_CLINICAL_STORAGE_KEYS = ["open-triage:offline-reports-v1", "open-triage:standard-encounter-v1", "open-triage:standard-encounter-v1:recovery", "open-triage:adult-chest-pain-v2"] as const;

/** Rollout deliberately destroys unsupported plaintext clinical state instead of migrating it. */
export function deleteLegacyClinicalStorage(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) { const key = storage.key(index); if (key) keys.push(key); }
  for (const key of keys) {
    if (LEGACY_CLINICAL_STORAGE_KEYS.includes(key as typeof LEGACY_CLINICAL_STORAGE_KEYS[number]) || key.startsWith("open-triage:standard-encounter-v1:report:") || key.startsWith("open-triage:report-sync-v1:")) storage.removeItem(key);
  }
}

function installProtectedCleanup(): void {
  if (!("indexedDB" in globalThis) || !("window" in globalThis)) return;
  const cleanup = () => void deleteExpiredProtectedRecords().catch(() => undefined);
  cleanup();
  window.addEventListener("online", cleanup);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") cleanup();
  });
  const timer = window.setInterval(cleanup, 15 * 60 * 1_000);
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
}

installProtectedCleanup();
