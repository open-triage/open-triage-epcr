import assert from "node:assert/strict";
import test from "node:test";
import { persistDispatchReceipt } from "../dist/dispatch/dispatch-receipt.persistence.js";

const source = {
  messageId: "10000000-0000-4000-8000-000000000001",
  sourceRecordId: "vendor-response-1",
  revision: 3,
  nested: { value: "retained" }
};

test("persists exact caller bytes and separate caller context without logging or reconstruction", async () => {
  const sourceBytes = Buffer.from(`{\n  "nested":{"value":"retained"},\n  "revision":3,\n  "sourceRecordId":"vendor-response-1",\n  "messageId":"10000000-0000-4000-8000-000000000001"\n}\n`);
  let captured;
  const writer = {
    async query(sql, parameters) {
      captured = { sql, parameters };
      return [{
        id: "20000000-0000-4000-8000-000000000001",
        organization_id: "30000000-0000-4000-8000-000000000001",
        source_id: "vendor-a",
        message_id: source.messageId,
        source_record_id: source.sourceRecordId,
        source_revision: "3",
        received_at: new Date("2026-09-03T12:00:00Z"),
        exact_sha256: "a".repeat(64),
        canonical_sha256: "b".repeat(64),
        status: "applied_with_findings",
        findings: [{ severity: "warning", code: "optional", pointer: "/nested", message: "retained in source" }],
        result: { appliedOccurrences: 4 }
      }];
    }
  };

  const receipt = await persistDispatchReceipt(writer, {
    organizationId: "30000000-0000-4000-8000-000000000001",
    sourceId: "vendor-a",
    sourceBytes,
    status: "applied_with_findings",
    findings: [{ severity: "warning", code: "optional", pointer: "/nested", message: "retained in source" }],
    result: { appliedOccurrences: 4 }
  });

  assert.deepEqual(captured.parameters.slice(0, 5), [
    "30000000-0000-4000-8000-000000000001", "vendor-a", source.messageId,
    source.sourceRecordId, 3
  ]);
  assert.deepEqual(captured.parameters[5], sourceBytes);
  assert.deepEqual(JSON.parse(captured.parameters[6]), source);
  assert.match(captured.sql, /insert into clinical\.dispatch_receipt/);
  assert.equal(receipt.sourceRevision, 3);
  assert.equal(receipt.receivedAt, "2026-09-03T12:00:00.000Z");
  assert.equal(receipt.canonicalSha256, "b".repeat(64));
});

test("rejects non-JSON source bytes before attempting persistence", async () => {
  let queried = false;
  await assert.rejects(persistDispatchReceipt({ query: async () => { queried = true; } }, {
    organizationId: "30000000-0000-4000-8000-000000000001",
    sourceId: "vendor-a",
    sourceBytes: Buffer.from("not-json"),
    status: "rejected",
    findings: [],
    result: {}
  }), /UTF-8 JSON object/);
  assert.equal(queried, false);
});
