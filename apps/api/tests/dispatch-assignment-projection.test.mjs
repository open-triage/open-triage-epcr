import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  projectDispatchAssignment,
  routeDispatchAssignment
} from "../dist/dispatch/dispatch-assignment.projection.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const source = JSON.parse(await readFile(resolve(root, "packages/contracts/examples/dispatch/synthetic-assignment.json"), "utf8"));
const organizationId = "30000000-0000-4000-8000-000000000001";
const unitId = "30000000-0000-4000-8000-000000000010";

function copy() {
  return structuredClone(source);
}

function element(message, id) {
  return message.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements)
    .find((candidate) => candidate.id === id);
}

function receiptRow(payload, status, result) {
  return {
    id: "30000000-0000-4000-8000-000000000020",
    organization_id: organizationId,
    source_id: "vendor-a",
    message_id: payload.messageId,
    source_record_id: payload.sourceRecordId,
    source_revision: String(payload.revision),
    received_at: "2026-09-04T00:00:00.000Z",
    exact_sha256: "a".repeat(64), canonical_sha256: "b".repeat(64),
    status, findings: [], result
  };
}

function input(canonical) {
  return {
    organizationId,
    sourceId: "vendor-a",
    sourceBytes: Buffer.from(JSON.stringify(canonical)),
    canonical,
    validationStatus: "applied",
    findings: []
  };
}

test("routes by agency-scoped eResponse.14 and retains distinct physical vehicle data", async () => {
  const canonical = copy();
  const writes = [];
  const writer = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from app_identity.operational_unit")) {
      assert.match(normalized, /organization_id = \$1 and call_sign = \$2/);
      assert.deepEqual(parameters, [organizationId, "SYNTHETIC-MEDIC-7"]);
      return [{ id: unitId }];
    }
    if (normalized.includes("from clinical.call_assignment ca")) return [];
    if (normalized.includes("select incident_id from clinical.call_assignment")) return [];
    if (normalized.includes("insert into clinical.dispatch_receipt")) {
      writes.push({ kind: "receipt", parameters });
      return [receiptRow(canonical, parameters[8], JSON.parse(parameters[9]))];
    }
    if (normalized.includes("insert into clinical.incident")) { writes.push({ kind: "incident", parameters }); return []; }
    if (normalized.includes("insert into clinical.call_assignment")) { writes.push({ kind: "assignment", parameters }); return []; }
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };

  const routed = await routeDispatchAssignment(writer, input(canonical));

  assert.equal(routed.status, "applied");
  assert.equal(routed.unitId, unitId);
  assert.equal(routed.projection.callSign, "SYNTHETIC-MEDIC-7");
  assert.equal(routed.projection.vehicleNumber, "SYNTHETIC-VEHICLE-7");
  const assignment = writes.find(({ kind }) => kind === "assignment");
  assert.equal(assignment.parameters[2], unitId);
  assert.equal(assignment.parameters[9], source.sourceRecordId);
  assert.equal(assignment.parameters[11], "SYNTHETIC-RESPONSE-0001");
  assert.equal(assignment.parameters[12], "SYNTHETIC-VEHICLE-7");
});

test("unknown call signs retain a quarantined receipt and create no clinician-visible assignment", async () => {
  const canonical = copy();
  element(canonical, "eResponse.14").values[0].value = "UNKNOWN-CALL-SIGN";
  const writes = [];
  const writer = { query: async (sql, parameters = []) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from app_identity.operational_unit")) return [];
    if (normalized.includes("insert into clinical.dispatch_receipt")) {
      writes.push(normalized);
      const result = JSON.parse(parameters[9]);
      assert.deepEqual(result, {
        reason: "unknown_call_sign", callSign: "UNKNOWN-CALL-SIGN",
        sourceRecordId: source.sourceRecordId, revision: 1
      });
      return [receiptRow(canonical, "quarantined", result)];
    }
    throw new Error(`Quarantined delivery must not write operational data: ${normalized}`);
  } };

  const quarantined = await routeDispatchAssignment(writer, input(canonical));
  assert.equal(quarantined.status, "quarantined");
  assert.equal(quarantined.receipt.status, "quarantined");
  assert.equal(quarantined.assignmentId, null);
  assert.equal(writes.length, 1);
});

test("stable source records cannot silently reassign units or response identities", async () => {
  const canonical = copy();
  const writer = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("from app_identity.operational_unit")) return [{ id: unitId }];
    if (normalized.includes("from clinical.call_assignment ca")) return [{
      id: "30000000-0000-4000-8000-000000000030",
      incident_id: "30000000-0000-4000-8000-000000000031",
      unit_id: "30000000-0000-4000-8000-000000000032",
      call_sign: "OTHER-MEDIC",
      response_number: "OTHER-RESPONSE"
    }];
    throw new Error(`Reassignment must fail before persistence: ${normalized}`);
  } };

  await assert.rejects(routeDispatchAssignment(writer, input(canonical)),
    /cancellation and a new sourceRecordId with a new response number/);
});

test("the projection never derives or accepts ownership of eRecord.01", () => {
  const canonical = copy();
  canonical.groups.find(({ id }) => id === "PatientCareReportGroup").instances[0].elements.push({
    id: "eRecord.01", values: [{ kind: "scalar", occurrenceId: "vendor-record", value: "VENDOR-PCR" }]
  });
  const projection = projectDispatchAssignment(canonical);
  assert.equal("recordNumber" in projection, false);
  assert.equal(projection.sourceRecordId, source.sourceRecordId);
  assert.notEqual(projection.sourceRecordId, "SYNTHETIC-RESPONSE-0001");
});
