import assert from "node:assert/strict";
import test from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AssignedCallsController } from "../dist/calls/assigned-calls.controller.js";
import { AssignedCallsService } from "../dist/calls/assigned-calls.service.js";

const session = {
  accessToken: "authenticated-demo-token",
  user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Synthetic Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" },
  startedAt: "2026-09-03T08:00:00.000Z",
  expiresAt: "2026-09-03T22:00:00.000Z"
};

test("the authenticated call-list integration returns only the clinician's assigned unit calls", async () => {
  const queries = [];
  const dataSource = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      return [{
        id: "32000000-0000-4000-8000-000000000011",
        call_number: "SYN-2026-0903-001",
        unit_id: "32000000-0000-4000-8000-000000000010",
        call_sign: "Medic 32",
        dispatched_at: new Date("2026-09-03T12:00:00.000Z"),
        dispatch_reason: "Medical assistance requested",
        chief_complaint: null,
        status: "assigned"
      }, {
        id: "32000000-0000-4000-8000-000000000012",
        call_number: "SYN-2026-0903-002",
        unit_id: "32000000-0000-4000-8000-000000000010",
        call_sign: "Medic 32",
        dispatched_at: new Date("2026-09-03T12:15:00.000Z"),
        dispatch_reason: "Canceled before opening",
        chief_complaint: null,
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
    callNumber: "SYN-2026-0903-001",
    unit: { id: "32000000-0000-4000-8000-000000000010", callSign: "Medic 32" },
    dispatchedAt: "2026-09-03T12:00:00.000Z",
    dispatchReason: "Medical assistance requested",
    chiefComplaint: null,
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
    call_number: "SYN-2026-0903-001",
    call_sign: "Medic 32",
    dispatched_at: new Date("2026-09-03T12:00:00.000Z"),
    dispatch_reason: "Medical assistance requested",
    chief_complaint: null,
    status: "assigned",
    report_id: null,
    synthetic: true,
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
    if (normalized.includes("insert into clinical.patient")) { writes.push("patient"); return []; }
    if (normalized.includes("update clinical.call_assignment")) {
      assignment.status = "opened";
      assignment.report_id = parameters[1];
      return [];
    }
    if (normalized.includes("insert into clinical.incident")) { writes.push("replacement-incident"); return []; }
    if (normalized.includes("insert into clinical.call_assignment")) { writes.push("replacement-assignment"); return []; }
    if (normalized.includes("from clinical.report where")) return [reports.get(parameters[0])];
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
  assert.equal(opened.replacementAssignment.callNumber, "SYN-2026-0903-002");
  assert.equal(opened.replacementAssignment.dispatchedAt, "2026-09-03T12:15:00.000Z");
  assert.equal(retried.replacementAssignment, null);
  assert.deepEqual(writes, ["patient", "report", "replacement-incident", "replacement-assignment"]);
});
