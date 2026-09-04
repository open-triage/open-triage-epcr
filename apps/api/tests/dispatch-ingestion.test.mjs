import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ingestDispatchDelivery } from "../dist/dispatch/dispatch-ingestion.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const catalog = JSON.parse(await readFile(resolve(root, "apps/web/app/data/nemsis-data-model-3.5.1.json"), "utf8"));
const source = JSON.parse(await readFile(resolve(root, "packages/contracts/examples/dispatch/synthetic-assignment.json"), "utf8"));
const context = {
  organizationId: "30000000-0000-4000-8000-000000000001",
  sourceId: "vendor-a"
};

function receipt(payload = source, status = "applied") {
  return {
    id: "30000000-0000-4000-8000-000000000020",
    message_id: payload.messageId,
    source_record_id: payload.sourceRecordId,
    source_revision: String(payload.revision),
    source_payload: payload,
    status,
    findings: []
  };
}

function input(payload) {
  return { ...context, sourceBytes: Buffer.from(JSON.stringify(payload)) };
}

test("production ingestion returns a replay without writing for an identical delivery", async () => {
  let writes = 0;
  const writer = { query: async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from clinical.dispatch_receipt")) return [receipt()];
    writes += 1;
    return [];
  } };
  const result = await ingestDispatchDelivery(writer, input(source), catalog);
  assert.deepEqual(result, {
    status: "replayed", originalStatus: "applied", sourceRecordId: source.sourceRecordId,
    revision: 1, receiptId: "30000000-0000-4000-8000-000000000020", findings: []
  });
  assert.equal(writes, 0);
});

test("production ingestion distinguishes message conflicts and stale revisions before projection", async () => {
  const messageConflict = structuredClone(source);
  messageConflict.groups.find(({ id }) => id === "eResponseSection").instances[0]
    .elements.find(({ id }) => id === "eResponse.13").values[0].value = "CHANGED";
  const conflictingWriter = { query: async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from clinical.dispatch_receipt")) return [receipt()];
    throw new Error("conflict must not write");
  } };
  const conflict = await ingestDispatchDelivery(conflictingWriter, input(messageConflict), catalog);
  assert.equal(conflict.status, "conflicting");
  assert.equal(conflict.conflict, "message_id");

  const current = structuredClone(source);
  current.messageId = "10000000-0000-4000-8000-000000000003";
  current.revision = 3;
  const stale = structuredClone(source);
  stale.messageId = "10000000-0000-4000-8000-000000000002";
  stale.revision = 2;
  const staleWriter = { query: async (sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from clinical.dispatch_receipt")) return [receipt(current)];
    throw new Error("stale delivery must not write");
  } };
  const staleResult = await ingestDispatchDelivery(staleWriter, input(stale), catalog);
  assert.deepEqual({ status: staleResult.status, revision: staleResult.revision, currentRevision: staleResult.currentRevision },
    { status: "stale", revision: 2, currentRevision: 3 });
});

test("invalid required content is rejected with a durable receipt when identity is usable", async () => {
  const invalid = structuredClone(source);
  invalid.groups.find(({ id }) => id === "eResponseSection").instances[0].elements =
    invalid.groups.find(({ id }) => id === "eResponseSection").instances[0].elements.filter(({ id }) => id !== "eResponse.14");
  const writer = { query: async (sql, parameters = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return [];
    if (sql.includes("from clinical.dispatch_receipt")) return [];
    if (sql.includes("insert into clinical.dispatch_receipt")) return [{
      ...receipt(invalid, "rejected"), organization_id: context.organizationId, source_id: context.sourceId,
      received_at: "2026-09-04T00:00:00Z", exact_sha256: "a".repeat(64), canonical_sha256: "b".repeat(64),
      result: JSON.parse(parameters[9])
    }];
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const result = await ingestDispatchDelivery(writer, input(invalid), catalog);
  assert.equal(result.status, "rejected");
  assert.equal(result.receiptId, "30000000-0000-4000-8000-000000000020");
  assert.ok(result.findings.some(({ code, elementId }) => code === "dispatch.required" && elementId === "eResponse.14"));
});
