import type { ProtectedReportKeyEnvelope } from "@open-triage/contracts";
import { apiRequestUrl, browserRequestConfiguration, browserRequestInit } from "./browser-api";

export const PROTECTED_CLINICAL_DATABASE = "open-triage-protected-clinical-v1";
export const PROTECTED_CLINICAL_STORE = "encrypted-reports";
export const PROTECTED_ENVELOPE_SCHEMA = 1 as const;

export interface ProtectedClinicalRecord {
  readonly localRecordId: string;
  readonly schemaVersion: 1;
  readonly algorithm: "AES-256-GCM";
  readonly recoveryHandle: string;
  readonly recoveryDeadline: string;
  readonly ciphertextRevision: number;
  readonly nonce: ArrayBuffer;
  readonly ciphertext: ArrayBuffer;
}

type ProtectedClinicalPayload = {
  readonly schemaVersion: 1;
  readonly report?: unknown;
  readonly shellState?: unknown;
};

type RuntimeContext = {
  readonly key: CryptoKey;
  readonly localRecordId: string;
  readonly envelope: ProtectedReportKeyEnvelope;
  payload: ProtectedClinicalPayload;
  revision: number;
  pending: Promise<void>;
};

const contexts = new Map<string, RuntimeContext>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function associatedData(recoveryHandle: string, ciphertextRevision: number): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: PROTECTED_ENVELOPE_SCHEMA,
    recoveryHandle,
    ciphertextRevision,
  })).buffer as ArrayBuffer;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROTECTED_CLINICAL_DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROTECTED_CLINICAL_STORE)) {
        database.createObjectStore(PROTECTED_CLINICAL_STORE, { keyPath: "localRecordId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Protected clinical storage could not be opened"));
  });
}

async function storeRecord(record: ProtectedClinicalRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readwrite");
      transaction.objectStore(PROTECTED_CLINICAL_STORE).put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Protected clinical write was aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Protected clinical write failed"));
    });
  } finally {
    database.close();
  }
}

async function deleteRecord(localRecordId: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(PROTECTED_CLINICAL_STORE, "readwrite");
      transaction.objectStore(PROTECTED_CLINICAL_STORE).delete(localRecordId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error("Protected clinical removal was aborted"));
      transaction.onerror = () => reject(transaction.error ?? new Error("Protected clinical removal failed"));
    });
  } finally {
    database.close();
  }
}

export async function encryptProtectedPayload(
  key: CryptoKey,
  recoveryHandle: string,
  ciphertextRevision: number,
  payload: unknown,
): Promise<Pick<ProtectedClinicalRecord, "nonce" | "ciphertext">> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonce,
    additionalData: associatedData(recoveryHandle, ciphertextRevision),
    tagLength: 128,
  }, key, new TextEncoder().encode(JSON.stringify(payload)));
  return { nonce: nonce.buffer.slice(0), ciphertext };
}

export async function decryptProtectedPayload(
  key: CryptoKey,
  record: Pick<ProtectedClinicalRecord, "schemaVersion" | "recoveryHandle" | "ciphertextRevision" | "nonce" | "ciphertext">,
): Promise<unknown> {
  if (record.schemaVersion !== PROTECTED_ENVELOPE_SCHEMA) throw new Error("Unsupported protected envelope schema");
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: record.nonce,
    additionalData: associatedData(record.recoveryHandle, record.ciphertextRevision),
    tagLength: 128,
  }, key, record.ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
}

async function persist(reportId: string): Promise<void> {
  const context = contexts.get(reportId);
  if (!context) return;
  const revision = context.revision + 1;
  const payload = structuredClone(context.payload);
  const encrypted = await encryptProtectedPayload(context.key, context.envelope.recoveryHandle, revision, payload);
  await storeRecord({
    localRecordId: context.localRecordId,
    schemaVersion: PROTECTED_ENVELOPE_SCHEMA,
    algorithm: "AES-256-GCM",
    recoveryHandle: context.envelope.recoveryHandle,
    recoveryDeadline: context.envelope.recoveryDeadline,
    ciphertextRevision: revision,
    ...encrypted,
  });
  context.revision = revision;
}

function queuePersist(reportId: string): Promise<void> {
  const context = contexts.get(reportId);
  if (!context) return Promise.resolve();
  context.pending = context.pending.then(() => persist(reportId));
  return context.pending;
}

export function protectedStorageActive(reportId: string): boolean {
  return contexts.has(reportId);
}

export async function prepareProtectedReport(csrfToken: string, reportId: string): Promise<boolean> {
  if (browserRequestConfiguration().mode !== "server") return false;
  if (contexts.has(reportId)) return true;
  if (!("indexedDB" in globalThis) || !globalThis.crypto?.subtle) return false;

  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", generated));
  const recoveryHandle = crypto.randomUUID();
  const url = apiRequestUrl(`/api/reports/${reportId}/protected-key-envelope`);
  if (!url) return false;
  const response = await fetch(url, browserRequestInit({
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
    body: JSON.stringify({ schemaVersion: 1, recoveryHandle, reportKeyBase64: bytesToBase64(raw) }),
  }));
  if (!response.ok) {
    raw.fill(0);
    throw new Error(response.status === 401 ? "Your shift session has ended." : "Protected offline storage could not be prepared.");
  }
  const envelope = await response.json() as ProtectedReportKeyEnvelope;
  const key = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  raw.fill(0);
  contexts.set(reportId, {
    key,
    localRecordId: crypto.randomUUID(),
    envelope,
    payload: { schemaVersion: PROTECTED_ENVELOPE_SCHEMA },
    revision: 0,
    pending: Promise.resolve(),
  });
  return true;
}

export function updateProtectedReport(reportId: string, report: unknown): void {
  const context = contexts.get(reportId);
  if (!context) return;
  context.payload = { ...context.payload, report };
  void queuePersist(reportId).catch(() => undefined);
}

export function updateProtectedShellState(reportId: string, shellState: unknown): void {
  const context = contexts.get(reportId);
  if (!context) return;
  context.payload = { ...context.payload, shellState };
  void queuePersist(reportId).catch(() => undefined);
}

export function protectedShellState(reportId: string): unknown {
  return contexts.get(reportId)?.payload.shellState;
}

export async function flushProtectedReport(reportId: string): Promise<void> {
  await contexts.get(reportId)?.pending;
}

export function removeProtectedReport(reportId: string): void {
  const context = contexts.get(reportId);
  if (!context) return;
  contexts.delete(reportId);
  void context.pending.catch(() => undefined)
    .then(() => deleteRecord(context.localRecordId))
    .catch(() => undefined);
}

export const LEGACY_CLINICAL_STORAGE_KEYS = [
  "open-triage:offline-reports-v1",
  "open-triage:standard-encounter-v1",
  "open-triage:standard-encounter-v1:recovery",
  "open-triage:adult-chest-pain-v2",
] as const;

/** Rollout deliberately destroys unsupported plaintext clinical state instead of migrating it. */
export function deleteLegacyClinicalStorage(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key) keys.push(key);
  }
  for (const key of keys) {
    if (LEGACY_CLINICAL_STORAGE_KEYS.includes(key as typeof LEGACY_CLINICAL_STORAGE_KEYS[number]) ||
        key.startsWith("open-triage:standard-encounter-v1:report:") ||
        key.startsWith("open-triage:report-sync-v1:")) storage.removeItem(key);
  }
}
