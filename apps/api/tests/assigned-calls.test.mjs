import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AssignedCallsController } from "../dist/calls/assigned-calls.controller.js";
import { AssignedCallsService, syntheticReplacementPayload } from "../dist/calls/assigned-calls.service.js";
import { randomSyntheticDispatchPayload, SYNTHETIC_DISPATCH_PAYLOAD_COUNT, syntheticDispatchPayloads } from "../dist/calls/synthetic-dispatch-payloads.js";

const dispatchSample = JSON.parse(readFileSync(new URL("../../../packages/contracts/examples/dispatch/synthetic-assignment-01.json", import.meta.url), "utf8"));

const session = {
  accessToken: "authenticated-demo-token",
  user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Synthetic Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" },
  startedAt: "2026-09-03T08:00:00.000Z",
  expiresAt: "2026-09-03T22:00:00.000Z"
};

test("a generated assignment carries forward the complete dispatch payload with next-call identities and times", () => {
  const earlierSample = structuredClone(dispatchSample);
  for (const instance of earlierSample.groups.flatMap((group) => group.instances)) {
    instance.elements = instance.elements.filter(({ id }) => !["eDispatch.05", "eScene.11"].includes(id));
  }
  const replacement = syntheticReplacementPayload(
    earlierSample,
    "SYN-20260903-002",
    new Date("2026-08-15T13:29:00.000Z"),
    "52000000-0000-4000-8000-000000000099",
  );
  const element = (id) => replacement.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find((candidate) => candidate.id === id).values[0].value;

  assert.equal(replacement.messageId, "52000000-0000-4000-8000-000000000099");
  assert.equal(replacement.sourceRecordId, "SYNTHETIC-SOURCE-RECORD-0002");
  assert.equal(replacement.sentAt, "2026-08-15T09:29:05-04:00");
  assert.equal(element("eResponse.03"), "SYN-20260903-002");
  assert.equal(element("eResponse.04"), "SYN-20260903-002-1");
  assert.equal(element("eTimes.02"), "2026-08-15T09:28:52-04:00");
  assert.equal(element("eTimes.03"), "2026-08-15T09:29:00-04:00");
  assert.deepEqual(replacement.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find((candidate) => candidate.id === "eDispatch.05").values[0], {
    kind: "coded", occurrenceId: "synthetic-dispatch-priority", code: "2305003", display: "Emergent"
  });
  assert.equal(element("eScene.11"), "40.750600,-73.997200");
  assert.equal(element("eScene.15"), "100 SYNTHETIC CHEST PAIN WAY");
  assert.equal(dispatchSample.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements).find((candidate) => candidate.id === "eResponse.03").values[0].value,
  "SYN-20260903-001");
});

test("the random fixture pool contains ten distinct dispatch payloads", () => {
  const payloads = syntheticDispatchPayloads();
  const characteristic = (payload) => ["eDispatch.01", "eDispatch.05", "eScene.11", "eScene.15"]
    .map((id) => payload.groups.flatMap((group) => group.instances).flatMap((instance) => instance.elements)
      .find((element) => element.id === id).values[0].code
      ?? payload.groups.flatMap((group) => group.instances).flatMap((instance) => instance.elements)
        .find((element) => element.id === id).values[0].value)
    .join("|");

  assert.equal(SYNTHETIC_DISPATCH_PAYLOAD_COUNT, 10);
  assert.equal(payloads.length, 10);
  assert.equal(new Set(payloads.map(characteristic)).size, 10);
  assert.equal(randomSyntheticDispatchPayload(() => 0).sourceRecordId, "SYNTHETIC-SOURCE-RECORD-0001");
  assert.equal(randomSyntheticDispatchPayload(() => 0.999999).sourceRecordId, "SYNTHETIC-SOURCE-RECORD-0010");
});

test("the authenticated call-list integration returns only the clinician's assigned unit calls", async () => {
  const queries = [];
  const dataSource = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      return [{
        id: "32000000-0000-4000-8000-000000000011",
        call_number: "SYN-20260903-001",
        unit_id: "32000000-0000-4000-8000-000000000010",
        call_sign: "Medic 32",
        dispatched_at: new Date("2026-09-03T12:00:00.000Z"),
        dispatch_reason: "Medical assistance requested",
        dispatch_priority_code: "2305003",
        dispatch_priority_display: "Emergent",
        chief_complaint: null,
        agency_time_zone: "America/New_York",
        status: "assigned"
      }, {
        id: "32000000-0000-4000-8000-000000000012",
        call_number: "SYN-20260903-002",
        unit_id: "32000000-0000-4000-8000-000000000010",
        call_sign: "Medic 32",
        dispatched_at: new Date("2026-09-03T12:15:00.000Z"),
        dispatch_reason: "Canceled before opening",
        chief_complaint: null,
        agency_time_zone: "America/New_York",
        status: "canceled"
      }];
    }
  };
  const sessions = { get: (token) => {
    assert.equal(token, session.accessToken);
    return session;
  } };
  const controller = new AssignedCallsController(new AssignedCallsService(dataSource, sessions));

  const result = await controller.list(`Bearer ${session.accessToken}`);

  assert.deepEqual(result.assignedCalls, [{
    id: "32000000-0000-4000-8000-000000000011",
    callNumber: "SYN-20260903-001",
    unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
    dispatchedAt: "2026-09-03T12:00:00.000Z",
    dispatchReason: "Medical assistance requested",
    dispatchPriority: { code: "2305003", display: "Emergent" },
    chiefComplaint: null,
    agencyTimeZone: "America/New_York",
    status: "assigned"
  }]);
  assert.deepEqual(result.canceledAssignmentIds, ["32000000-0000-4000-8000-000000000012"]);
  assert.deepEqual(queries[0].parameters, [session.user.id, session.organization.id]);
  assert.match(queries[0].sql, /ca\.status in \('assigned', 'canceled'\)/);
  assert.match(queries[0].sql, /uc\.user_id = \$1/);
});

test("the assigned-call endpoint requires a current clinician session", async () => {
  const controller = new AssignedCallsController({ list: async () => ({ assignedCalls: [], canceledAssignmentIds: [], refreshedAt: "" }) });
  assert.throws(() => controller.list(), (error) => error instanceof UnauthorizedException);
});

test("opening and retrying one assignment creates one pinned creator-owned draft and one replacement", async () => {
  const assignment = {
    id: "32000000-0000-4000-8000-000000000011",
    organization_id: session.organization.id,
    unit_id: "32000000-0000-4000-8000-000000000010",
    incident_id: "32000000-0000-4000-8000-00000000000f",
    call_number: "SYN-20260903-001",
    call_sign: "Medic 32",
    dispatched_at: new Date("2026-09-03T12:00:00.000Z"),
    dispatch_reason: "Medical assistance requested",
    chief_complaint: null,
    agency_time_zone: "America/New_York",
    status: "assigned",
    report_id: null,
    synthetic: true,
    dispatch_receipt_id: null,
    default_form_id: "32000000-0000-4000-8000-000000000007"
  };
  const reports = new Map();
  const writes = [];
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("for update of ca")) return [assignment];
    if (normalized.includes("from forms.form_version")) {
      assert.match(normalized, /status = 'published'.*order by fv\.version desc/s);
      return [{ id: "latest-published-version", catalog_release_id: "catalog-release" }];
    }
    if (normalized.includes("from app_identity.agency_demographic_version")) return [{ id: "agency-version" }];
    if (normalized.includes("insert into clinical.report")) {
      writes.push("report");
      reports.set(parameters[0], {
        id: parameters[0], documenting_user_id: parameters[7], form_version_id: parameters[5],
        catalog_release_id: parameters[6], revision: "0", status: "draft"
      });
      return [];
    }
    if (normalized.includes("insert into clinical.group_instance")) return [];
    if (normalized.includes("from catalog.element_definition")) return [{
      element_id: "eRecord.01", element_identity_id: "record-identity", base_datatype: "string", analytical_repeatable: false, identifying: false
    }];
    if (normalized.includes("insert into clinical.element_occurrence")) return [];
    if (normalized.includes("insert into clinical.patient")) { writes.push("patient"); return []; }
    if (normalized.includes("update clinical.call_assignment")) {
      assignment.status = "opened";
      assignment.report_id = parameters[1];
      return [];
    }
    if (normalized.includes("insert into clinical.dispatch_receipt")) { writes.push("replacement-receipt"); return []; }
    if (normalized.includes("insert into clinical.incident")) { writes.push("replacement-incident"); return []; }
    if (normalized.includes("insert into clinical.call_assignment")) { writes.push("replacement-assignment"); return []; }
    if (normalized.includes("from clinical.report where")) return [reports.get(parameters[0])];
    if (normalized.includes("join forms.form_version")) return [{
      id: parameters[0], created_at: "2026-09-03T12:00:00.000Z", updated_at: "2026-09-03T12:00:00.000Z",
      form_id: "form", form_version: 1, catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet"
    }];
    if (normalized.includes("from clinical.group_instance")) return [];
    if (normalized.includes("from clinical.element_occurrence")) return [];
    if (normalized.includes("from clinical.dispatch_conflict")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const dataSource = { transaction: (work) => work(manager) };
  const sessions = { get: (token) => {
    assert.equal(token, session.accessToken);
    return session;
  } };
  const controller = new AssignedCallsController(new AssignedCallsService(dataSource, sessions));

  const opened = await controller.open(assignment.id, `Bearer ${session.accessToken}`);
  const retried = await controller.open(assignment.id, `Bearer ${session.accessToken}`);

  assert.equal(opened.report.id, retried.report.id);
  assert.equal(opened.report.documentingUserId, session.user.id);
  assert.equal(opened.report.formVersionId, "latest-published-version");
  assert.equal(opened.report.document.encounter.id, opened.report.id);
  assert.equal(opened.report.agencyTimeZone, "America/New_York");
  assert.deepEqual(opened.report.dispatchConflicts, []);
  assert.equal(opened.replacementAssignment.callNumber, "SYN-20260903-002");
  assert.equal(opened.replacementAssignment.dispatchedAt, "2026-09-03T12:15:00.000Z");
  assert.equal(opened.replacementAssignment.agencyTimeZone, "America/New_York");
  assert.equal(retried.replacementAssignment, null);
  assert.deepEqual(writes, ["patient", "report", "replacement-receipt", "replacement-incident", "replacement-assignment"]);
});

test("a serialization failure while opening an assignment surfaces as a retriable conflict, not a raw 500", async () => {
  const dataSource = {
    transaction: async () => {
      const error = new Error("could not serialize access due to concurrent update");
      error.code = "40001";
      throw error;
    }
  };
  const sessions = { get: (token) => {
    assert.equal(token, session.accessToken);
    return session;
  } };
  const service = new AssignedCallsService(dataSource, sessions);

  await assert.rejects(
    service.open(session.accessToken, "32000000-0000-4000-8000-000000000011"),
    (error) => error instanceof ConflictException && error.getStatus() === 409
  );
});

test("a not-found error while opening an assignment keeps its original status instead of becoming a conflict", async () => {
  const dataSource = { transaction: (work) => work({ query: async () => [] }) };
  const sessions = { get: (token) => {
    assert.equal(token, session.accessToken);
    return session;
  } };
  const service = new AssignedCallsService(dataSource, sessions);

  await assert.rejects(
    service.open(session.accessToken, "32000000-0000-4000-8000-000000000011"),
    (error) => error instanceof NotFoundException && error.getStatus() === 404
  );
});
