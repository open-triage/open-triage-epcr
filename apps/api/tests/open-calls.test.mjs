import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { DraftReportController } from "../dist/reports/draft-report.controller.js";
import { DraftReportService } from "../dist/reports/draft-report.service.js";
import { SignReportService } from "../dist/reports/sign-report.service.js";

const ownerSession = {
  accessToken: "owner-token",
  user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Owner" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "Agency" },
  startedAt: "2026-09-03T08:00:00.000Z",
  expiresAt: "2026-09-03T22:00:00.000Z"
};

function sessions() {
  return { get(token) {
    if (token !== ownerSession.accessToken) throw new UnauthorizedException();
    return ownerSession;
  } };
}

test("open calls list only creator-owned drafts in newest-activity order with workflow details", async () => {
  const queries = [];
  const dataSource = { query: async (sql, parameters) => {
    queries.push({ sql: sql.replace(/\s+/g, " "), parameters });
    return [
      {
        report_id: "42000000-0000-4000-8000-000000000002", call_number: "CALL-NEW",
        dispatched_at: "2026-09-03T12:00:00.000Z", dispatch_reason: "Breathing problem",
        dispatch_priority_code: "2305003", dispatch_priority_display: "Emergent",
        chief_complaint: "Shortness of breath", unit_call_sign: "Medic 32",
        agency_time_zone: "America/New_York",
        status: "draft",
        last_saved_at: "2026-09-03T14:00:00.000Z", revision: "4",
        form_version_id: "52000000-0000-4000-8000-000000000002", catalog_release_id: "62000000-0000-4000-8000-000000000002",
        validation_error_count: 2
      },
      {
        report_id: "42000000-0000-4000-8000-000000000001", call_number: "CALL-OLD",
        dispatched_at: "2026-09-03T11:00:00.000Z", dispatch_reason: "Fall",
        chief_complaint: null, unit_call_sign: "Medic 31",
        agency_time_zone: "America/New_York",
        status: "draft",
        last_saved_at: new Date("2026-09-03T13:00:00.000Z"), revision: 1,
        form_version_id: "52000000-0000-4000-8000-000000000001", catalog_release_id: "62000000-0000-4000-8000-000000000001",
        validation_error_count: "0"
      }
    ];
  } };
  const service = new DraftReportService(dataSource, sessions());
  const controller = new DraftReportController(service, {}, {});

  const result = await controller.listOpen(`Bearer ${ownerSession.accessToken}`);

  assert.deepEqual(result.openCalls.map((call) => call.callNumber), ["CALL-NEW", "CALL-OLD"]);
  assert.deepEqual(result.openCalls[0], {
    reportId: "42000000-0000-4000-8000-000000000002", callNumber: "CALL-NEW",
    dispatchedAt: "2026-09-03T12:00:00.000Z", dispatchReason: "Breathing problem",
    dispatchPriority: { code: "2305003", display: "Emergent" },
    chiefComplaint: "Shortness of breath", unitCallSign: "Medic 32",
    agencyTimeZone: "America/New_York",
    lastSavedAt: "2026-09-03T14:00:00.000Z", syncStatus: "saved", validationErrorCount: 2,
    revision: 4, formVersionId: "52000000-0000-4000-8000-000000000002",
    catalogReleaseId: "62000000-0000-4000-8000-000000000002"
  });
  assert.deepEqual(queries[0].parameters, [ownerSession.organization.id, ownerSession.user.id]);
  assert.deepEqual(result.completedReportIds, []);
  assert.match(queries[0].sql, /r\.documenting_user_id = \$2 and r\.status in \('draft', 'signed'\)/);
  assert.match(queries[0].sql, /order by r\.updated_at desc/);
  assert.match(queries[0].sql, /vf\.severity = 'error' and vf\.revision = r\.revision/);
});

test("stationary-completed reports are returned as reconciliation identities, not open calls", async () => {
  const completedReportId = "42000000-0000-4000-8000-000000000003";
  const dataSource = { query: async () => [{
    report_id: completedReportId, status: "signed", call_number: "CALL-COMPLETE",
    dispatched_at: "2026-09-03T12:00:00.000Z", dispatch_reason: "Transfer",
    chief_complaint: null, unit_call_sign: "Medic 32",
    last_saved_at: "2026-09-03T14:10:00.000Z", revision: 5,
    form_version_id: "52000000-0000-4000-8000-000000000003",
    catalog_release_id: "62000000-0000-4000-8000-000000000003",
    validation_error_count: 0
  }] };
  const service = new DraftReportService(dataSource, sessions());

  const result = await service.listOpen(ownerSession.accessToken);

  assert.deepEqual(result.openCalls, []);
  assert.deepEqual(result.completedReportIds, [completedReportId]);
});

test("reopening restores the creator's report with its pinned form and saved content", async () => {
  const reportId = "42000000-0000-4000-8000-000000000002";
  const queries = [];
  const report = {
    id: reportId, status: "draft", revision: "4", organization_id: ownerSession.organization.id,
    incident_id: "incident", patient_id: "patient", agency_demographic_version_id: "agency",
    form_version_id: "pinned-form", catalog_release_id: "pinned-catalog", documenting_user_id: ownerSession.user.id
  };
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    queries.push({ sql: normalized, parameters });
    if (normalized.includes("from clinical.report where id")) return [report];
    if (normalized.includes("join forms.form_version")) return [{
      id: reportId, created_at: "2026-09-03T12:00:00.000Z", updated_at: "2026-09-03T12:05:00.000Z",
      form_id: "form", form_version: 7, catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet"
    }];
    if (normalized.includes("select id, parent_group_instance_id, group_id, ordinal")) return [
      { id: "parent-group", parent_group_instance_id: null, group_id: "PatientCareReportGroup", ordinal: 0 },
      { id: "child-group", parent_group_instance_id: "parent-group", group_id: "ePatientSection", ordinal: 0 }
    ];
    if (normalized.includes("select id, group_instance_id, element_id, ordinal")) return [{
      id: "hidden-occurrence", group_instance_id: "child-group", element_id: "ePatient.17", ordinal: 0,
      value_kind: "date", value_date: "1980-01-01", provenance_detail: null, source_attributes: null
    }];
    if (normalized.includes("from clinical.group_instance")) return [{ id: "group-1" }];
    if (normalized.includes("from clinical.element_occurrence")) return [{ id: "occurrence-1" }];
    if (normalized.includes("from clinical.dispatch_conflict")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const dataSource = {
    transaction: (work) => work(manager),
    query: async (sql, parameters) => {
      queries.push({ sql: sql.replace(/\s+/g, " "), parameters });
      return [{
        call_number: "CALL-NEW", dispatched_at: "2026-09-03T12:00:00.000Z",
        dispatch_reason: "Breathing problem", chief_complaint: "Shortness of breath",
        dispatch_priority_code: "2305003", dispatch_priority_display: "Emergent",
        unit_call_sign: "Medic 32", dispatch_canceled_at: "2026-09-03T12:18:31.000Z",
        dispatch_cancellation_revision: "3", dispatch_cancellation_receipt_id: "dispatch-receipt",
        agency_time_zone: "America/New_York"
      }];
    }
  };
  const service = new DraftReportService(dataSource, sessions());
  const controller = new DraftReportController(service, {}, {});

  const reopened = await controller.reopen(reportId, `Bearer ${ownerSession.accessToken}`);

  assert.equal(reopened.callNumber, "CALL-NEW");
  assert.equal(reopened.dispatchedAt, "2026-09-03T12:00:00.000Z");
  assert.equal(reopened.dispatchReason, "Breathing problem");
  assert.deepEqual(reopened.dispatchPriority, { code: "2305003", display: "Emergent" });
  assert.equal(reopened.unitCallSign, "Medic 32");
  assert.equal(reopened.report.agencyTimeZone, "America/New_York");
  assert.equal(reopened.report.formVersionId, "pinned-form");
  assert.deepEqual(reopened.report.dispatchCancellation, {
    canceledAt: "2026-09-03T12:18:31.000Z", dispatchRevision: 3, receiptId: "dispatch-receipt"
  });
  const patient = reopened.report.document.groups.find(({ id }) => id === "ePatientSection").instances[0];
  assert.equal(patient.parentInstanceId, "parent-group");
  assert.equal(patient.elements[0].values[0].value, "1980-01-01");
  assert.ok(queries.every(({ parameters }) => !parameters || !parameters.includes("another-user")));
  assert.deepEqual(queries[0].parameters, [reportId, ownerSession.organization.id, ownerSession.user.id]);
});

test("active report polling returns separate revisions and omits the document for a matching ETag", async () => {
  const reportId = "42000000-0000-4000-8000-000000000002";
  let transactions = 0;
  const dataSource = {
    query: async (sql, parameters) => {
      assert.match(sql, /ca\.dispatch_revision/);
      assert.deepEqual(parameters, [reportId, ownerSession.organization.id, ownerSession.user.id]);
      return [{ revision: "9", dispatch_revision: "4", dispatch_canceled_at: null,
        dispatch_cancellation_revision: null, dispatch_cancellation_receipt_id: null }];
    },
    transaction: async () => { transactions += 1; throw new Error("unchanged polling must not load a document"); },
  };
  const service = new DraftReportService(dataSource, sessions());
  const result = await service.active(ownerSession.accessToken, reportId, '"report-9-dispatch-4"');
  assert.deepEqual(result, { etag: '"report-9-dispatch-4"', resource: null });
  assert.equal(transactions, 0);
});

test("the conditional controller emits a bodyless 304 with the current ETag", async () => {
  const response = {
    headers: new Map(), statusCode: 200,
    setHeader(name, value) { this.headers.set(name, value); },
    status(code) { this.statusCode = code; return this; },
  };
  const reports = { active: async (token, reportId, etag) => {
    assert.equal(token, ownerSession.accessToken);
    assert.equal(reportId, "42000000-0000-4000-8000-000000000002");
    assert.equal(etag, '"report-9-dispatch-4"');
    return { etag, resource: null };
  } };
  const controller = new DraftReportController(reports, {}, {});
  const body = await controller.active("42000000-0000-4000-8000-000000000002",
    `Bearer ${ownerSession.accessToken}`, '"report-9-dispatch-4"', response);
  assert.equal(body, undefined);
  assert.equal(response.statusCode, 304);
  assert.equal(response.headers.get("ETag"), '"report-9-dispatch-4"');
});

test("changed active report polling returns the provenance-merged canonical document", async () => {
  const reportId = "42000000-0000-4000-8000-000000000002";
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("join forms.form_version")) return [{
      id: reportId, created_at: "2026-09-03T12:00:00.000Z", updated_at: "2026-09-03T12:09:00.000Z",
      form_id: "form", form_version: 7, catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet"
    }];
    if (normalized.includes("select id, parent_group_instance_id")) return [{ id: "dispatch-group", parent_group_instance_id: null, group_id: "eDispatchSection", ordinal: 0 }];
    if (normalized.includes("select id, group_instance_id")) return [{
      id: "dispatch-occurrence", group_instance_id: "dispatch-group", element_id: "eDispatch.06", ordinal: 0,
      value_kind: "text", value_text: "CAD-UPDATED", provenance_kind: "dispatch", provenance_detail: { sourceValue: { kind: "scalar", occurrenceId: "source-cad", value: "CAD-UPDATED" } }, source_attributes: null
    }];
    if (normalized.includes("from clinical.dispatch_conflict")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const dataSource = {
    query: async () => [{ revision: "9", dispatch_revision: "4", dispatch_canceled_at: null,
      dispatch_cancellation_revision: null, dispatch_cancellation_receipt_id: null }],
    transaction: (work) => work(manager),
  };
  const service = new DraftReportService(dataSource, sessions());
  const result = await service.active(ownerSession.accessToken, reportId, '"report-8-dispatch-3"');
  assert.equal(result.resource.reportRevision, 9);
  assert.equal(result.resource.dispatchRevision, 4);
  assert.equal(result.resource.document.groups[0].instances[0].elements[0].values[0].value, "CAD-UPDATED");
});

test("another clinician cannot read, write, reopen, or replay a queued draft command", async () => {
  const reportId = "42000000-0000-4000-8000-000000000002";
  const queried = [];
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    queried.push(normalized);
    if (normalized.includes("pg_advisory_xact_lock")) return [];
    if (normalized.includes("from clinical.report")) return [];
    throw new Error(`Ownership must be checked before queued command lookup: ${normalized}`);
  } };
  const dataSource = { transaction: (first, second) => (typeof first === "function" ? first(manager) : second(manager)) };
  const service = new DraftReportService(dataSource, sessions());
  const save = {
    commandId: "72000000-0000-4000-8000-000000000001", expectedRevision: 0,
    authorId: ownerSession.user.id,
    occurrences: [{
      id: "72000000-0000-4000-8000-000000000002",
      elementId: "eScene.01",
      value: { kind: "text", value: "queued update" }
    }]
  };

  await assert.rejects(service.get(ownerSession.accessToken, reportId), NotFoundException);
  await assert.rejects(service.reopen(ownerSession.accessToken, reportId), NotFoundException);
  await assert.rejects(service.save(ownerSession.accessToken, reportId, save), NotFoundException);
  assert.ok(!queried.some((sql) => sql.includes("clinical.command_receipt")));
});

test("open-call endpoints require a clinician session", () => {
  const controller = new DraftReportController({ listOpen() {} }, {}, {});
  assert.throws(() => controller.listOpen(), UnauthorizedException);
  assert.throws(() => controller.reopen("42000000-0000-4000-8000-000000000002"), UnauthorizedException);
});

test("another clinician cannot replay a queued signing command", async () => {
  const queried = [];
  const manager = { query: async (sql) => {
    const normalized = sql.replace(/\s+/g, " ");
    queried.push(normalized);
    if (normalized.includes("pg_advisory_xact_lock")) return [];
    if (normalized.includes("from clinical.report")) return [];
    throw new Error(`Ownership must be checked before signing receipt lookup: ${normalized}`);
  } };
  const dataSource = { transaction: (_isolation, work) => work(manager) };
  const signing = new SignReportService(dataSource, sessions());

  await assert.rejects(signing.sign(ownerSession.accessToken, "42000000-0000-4000-8000-000000000002", {
    commandId: "72000000-0000-4000-8000-000000000003",
    expectedRevision: 1,
    signerId: ownerSession.user.id,
    attestation: { meaning: "author approval" }
  }), NotFoundException);
  assert.ok(!queried.some((sql) => sql.includes("clinical.command_receipt")));
});
