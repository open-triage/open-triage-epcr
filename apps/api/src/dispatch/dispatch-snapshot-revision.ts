import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type DispatchStableValueIdentity = {
  readonly groupId: string;
  readonly instanceId: string;
  readonly elementId: string;
  readonly occurrenceId: string;
};

export type DispatchSnapshotChange = DispatchStableValueIdentity & {
  readonly previousValue?: unknown;
  readonly value?: unknown;
};

export type AppliedDispatchRevisionResult = {
  readonly status: "applied" | "applied_with_findings";
  readonly sourceRecordId: string;
  readonly revision: number;
  readonly previousRevision: number | null;
  readonly revisionGap: { readonly firstMissing: number; readonly lastMissing: number } | null;
  readonly added: ReadonlyArray<DispatchSnapshotChange>;
  readonly replaced: ReadonlyArray<DispatchSnapshotChange>;
  readonly retracted: ReadonlyArray<DispatchSnapshotChange>;
};

export type RejectedDispatchRevisionResult = {
  readonly status: "conflicting" | "stale";
  readonly sourceRecordId: string;
  readonly revision: number;
  readonly currentRevision: number;
  readonly conflict?: "message_id" | "source_revision";
};

export type DispatchRevisionResult = AppliedDispatchRevisionResult | RejectedDispatchRevisionResult;

type AcceptedRevision = {
  readonly messageIds: ReadonlyArray<string>;
  readonly deliveryDigests: Readonly<Record<string, string>>;
  readonly snapshotDigest: string;
  readonly canonical: JsonRecord;
  readonly result: AppliedDispatchRevisionResult;
};

export type DispatchRevisionState = {
  readonly sourceRecordId: string | null;
  readonly revisions: Readonly<Record<number, AcceptedRevision>>;
  readonly messageDigests: Readonly<Record<string, string>>;
  readonly messageRevisions: Readonly<Record<string, number>>;
};

export type AcceptedDispatchDelivery = {
  readonly canonical: JsonRecord;
  readonly status: "applied" | "applied_with_findings";
};

export type ApplyDispatchRevisionOutcome = {
  readonly state: DispatchRevisionState;
  /** Exact retries and canonically equivalent same-revision retries return this original object. */
  readonly result: DispatchRevisionResult;
};

export function emptyDispatchRevisionState(): DispatchRevisionState {
  return { sourceRecordId: null, revisions: {}, messageDigests: {}, messageRevisions: {} };
}

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredIdentity(canonical: JsonRecord): { messageId: string; sourceRecordId: string; revision: number } {
  const { messageId, sourceRecordId, revision } = canonical;
  if (typeof messageId !== "string" || typeof sourceRecordId !== "string" ||
      !Number.isSafeInteger(revision) || Number(revision) < 1) {
    throw new TypeError("Accepted dispatch snapshot is missing its message or revision identity");
  }
  return { messageId, sourceRecordId, revision: Number(revision) };
}

function stableArray(values: unknown[]): unknown[] {
  const identities = values.map((value) => {
    if (!record(value)) return null;
    for (const key of ["id", "instanceId", "occurrenceId"] as const) {
      if (typeof value[key] === "string") return `${key}:${value[key]}`;
    }
    return null;
  });
  if (identities.every((identity) => identity !== null) && new Set(identities).size === identities.length) {
    return values.map((value, index) => ({ value, identity: identities[index]! }))
      .sort((left, right) => left.identity.localeCompare(right.identity))
      .map(({ value }) => stableJson(value));
  }
  return values.map(stableJson);
}

/** Canonical JSON ignores object-property and stable structural collection order. */
function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return stableArray(value);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableJson(value))).digest("hex");
}

export function dispatchCanonicalDigest(canonical: JsonRecord): string {
  return sha256(canonical);
}

export function dispatchSnapshotDigest(canonical: JsonRecord): string {
  const snapshot = { ...canonical };
  delete snapshot.messageId;
  delete snapshot.sentAt;
  delete snapshot.revision;
  return sha256(snapshot);
}

function valuesByIdentity(canonical: JsonRecord): Map<string, DispatchSnapshotChange> {
  const values = new Map<string, DispatchSnapshotChange>();
  const groups = Array.isArray(canonical.groups) ? canonical.groups : [];
  for (const group of groups) {
    if (!record(group) || typeof group.id !== "string" || !Array.isArray(group.instances)) continue;
    for (const instance of group.instances) {
      if (!record(instance) || typeof instance.instanceId !== "string" || !Array.isArray(instance.elements)) continue;
      for (const element of instance.elements) {
        if (!record(element) || typeof element.id !== "string" || !Array.isArray(element.values)) continue;
        for (const value of element.values) {
          if (!record(value) || typeof value.occurrenceId !== "string") continue;
          const identity = {
            groupId: group.id,
            instanceId: instance.instanceId,
            elementId: element.id,
            occurrenceId: value.occurrenceId
          };
          values.set(JSON.stringify(Object.values(identity)), { ...identity, value });
        }
      }
    }
  }
  return values;
}

function snapshotChanges(previous: JsonRecord | undefined, next: JsonRecord): Pick<AppliedDispatchRevisionResult, "added" | "replaced" | "retracted"> {
  const before = previous ? valuesByIdentity(previous) : new Map<string, DispatchSnapshotChange>();
  const after = valuesByIdentity(next);
  const added: DispatchSnapshotChange[] = [];
  const replaced: DispatchSnapshotChange[] = [];
  const retracted: DispatchSnapshotChange[] = [];
  for (const [key, incoming] of after) {
    const existing = before.get(key);
    if (!existing) added.push(incoming);
    else if (sha256(existing.value) !== sha256(incoming.value)) {
      replaced.push({ ...incoming, previousValue: existing.value });
    }
  }
  for (const [key, existing] of before) {
    if (!after.has(key)) retracted.push({ ...existing, previousValue: existing.value, value: undefined });
  }
  const order = (left: DispatchSnapshotChange, right: DispatchSnapshotChange): number =>
    JSON.stringify([left.groupId, left.instanceId, left.elementId, left.occurrenceId])
      .localeCompare(JSON.stringify([right.groupId, right.instanceId, right.elementId, right.occurrenceId]));
  return { added: added.sort(order), replaced: replaced.sort(order), retracted: retracted.sort(order) };
}

/**
 * Applies one already validated delivery to a source-record ledger. The function is pure so
 * a transaction-backed ingestion adapter can lock, load, apply, and persist it atomically.
 */
export function applyDispatchSnapshotRevision(
  state: DispatchRevisionState,
  delivery: AcceptedDispatchDelivery
): ApplyDispatchRevisionOutcome {
  const { canonical } = delivery;
  const identity = requiredIdentity(canonical);
  if (state.sourceRecordId !== null && state.sourceRecordId !== identity.sourceRecordId) {
    throw new TypeError("A dispatch revision ledger may contain only one source record");
  }
  const deliveryDigest = dispatchCanonicalDigest(canonical);
  const knownMessageDigest = state.messageDigests[identity.messageId];
  if (knownMessageDigest !== undefined) {
    const knownRevision = state.messageRevisions[identity.messageId]!;
    const original = state.revisions[knownRevision]!;
    if (knownMessageDigest === deliveryDigest) return { state, result: original.result };
    return {
      state,
      result: { status: "conflicting", sourceRecordId: identity.sourceRecordId, revision: identity.revision,
        currentRevision: Math.max(...Object.keys(state.revisions).map(Number)), conflict: "message_id" }
    };
  }

  const revisionNumbers = Object.keys(state.revisions).map(Number);
  const currentRevision = revisionNumbers.length ? Math.max(...revisionNumbers) : 0;
  const snapshotDigest = dispatchSnapshotDigest(canonical);
  const knownRevision = state.revisions[identity.revision];
  if (knownRevision) {
    if (knownRevision.snapshotDigest !== snapshotDigest) {
      return { state, result: { status: "conflicting", sourceRecordId: identity.sourceRecordId,
        revision: identity.revision, currentRevision, conflict: "source_revision" } };
    }
    const aliased: AcceptedRevision = {
      ...knownRevision,
      messageIds: [...knownRevision.messageIds, identity.messageId],
      deliveryDigests: { ...knownRevision.deliveryDigests, [identity.messageId]: deliveryDigest }
    };
    return {
      state: {
        ...state,
        revisions: { ...state.revisions, [identity.revision]: aliased },
        messageDigests: { ...state.messageDigests, [identity.messageId]: deliveryDigest },
        messageRevisions: { ...state.messageRevisions, [identity.messageId]: identity.revision }
      },
      result: knownRevision.result
    };
  }
  if (identity.revision < currentRevision) {
    return { state, result: { status: "stale", sourceRecordId: identity.sourceRecordId,
      revision: identity.revision, currentRevision } };
  }

  const previous = currentRevision === 0 ? undefined : state.revisions[currentRevision]!.canonical;
  const changes = snapshotChanges(previous, canonical);
  const result: AppliedDispatchRevisionResult = {
    status: delivery.status,
    sourceRecordId: identity.sourceRecordId,
    revision: identity.revision,
    previousRevision: currentRevision || null,
    revisionGap: identity.revision > currentRevision + 1
      ? { firstMissing: currentRevision + 1, lastMissing: identity.revision - 1 }
      : null,
    ...changes
  };
  const accepted: AcceptedRevision = {
    messageIds: [identity.messageId],
    deliveryDigests: { [identity.messageId]: deliveryDigest },
    snapshotDigest,
    canonical,
    result
  };
  return {
    state: {
      sourceRecordId: identity.sourceRecordId,
      revisions: { ...state.revisions, [identity.revision]: accepted },
      messageDigests: { ...state.messageDigests, [identity.messageId]: deliveryDigest },
      messageRevisions: { ...state.messageRevisions, [identity.messageId]: identity.revision }
    },
    result
  };
}
