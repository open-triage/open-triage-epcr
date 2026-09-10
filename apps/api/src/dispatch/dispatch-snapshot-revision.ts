import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
