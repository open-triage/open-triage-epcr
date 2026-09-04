import assert from "node:assert/strict";
import test from "node:test";
import { retainPostSignatureDispatch } from "../dist/dispatch/dispatch-post-signature.js";

test("post-signature delivery retains its proposed differences and amendment requirement without report writes", async () => {
  const writes = [];
  const writer = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    if (normalized.includes("from clinical.element_occurrence")) return [];
    writes.push({ sql: normalized, parameters });
    return [];
  } };
  const canonical = { eventType: "cancel", groups: [{ id: "eTimesSection", instances: [{
    instanceId: "times", elements: [{ id: "eTimes.14", values: [{
      kind: "scalar", occurrenceId: "canceled", value: "2026-08-15T13:18:31Z"
    }] }]
  }] }] };
  const differences = await retainPostSignatureDispatch(writer, {
    reportId: "10000000-0000-4000-8000-000000000001",
    receiptId: "20000000-0000-4000-8000-000000000002",
    dispatchRevision: 3, eventType: "cancel", canonical
  });
  assert.equal(differences.length, 1);
  assert.equal(differences[0].kind, "apply");
  assert.equal(writes.length, 1);
  assert.match(writes[0].sql, /insert into clinical_audit\.post_signature_dispatch_delivery/);
  assert.deepEqual(JSON.parse(writes[0].parameters[4]), canonical);
  assert.ok(!writes.some(({ sql }) => /update clinical\.(report|element_occurrence|signed_snapshot)/.test(sql)));
});
