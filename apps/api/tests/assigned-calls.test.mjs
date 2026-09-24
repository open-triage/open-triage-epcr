import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ConflictException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { AssignedCallsController } from "../dist/calls/assigned-calls.controller.js";
import { AssignedCallsService, syntheticReplacementPayload } from "../dist/calls/assigned-calls.service.js";
import { randomSyntheticDispatchPayload, SYNTHETIC_DISPATCH_PAYLOAD_COUNT, syntheticDispatchPayloads } from "../dist/calls/synthetic-dispatch-payloads.js";
import { validateDispatchAssignment } from "../dist/dispatch/dispatch-assignment.validation.js";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";

process.env.PATIENT_KEY_INSTALLATION_ID ??= "91000000-0000-4000-8000-000000000001";
process.env.PATIENT_KEY_VERSION ??= "1";
process.env.PATIENT_KEY_SECRET_BASE64 ??= Buffer.alloc(32, 0x31).toString("base64");

const dispatchSample = JSON.parse(readFileSync(new URL("../../../packages/contracts/examples/dispatch/synthetic-assignment-01.json", import.meta.url), "utf8"));
const dispatchCatalog = JSON.parse(readFileSync(new URL("../../../defines/catalog/catalog_nemsis-3.5.1.json", import.meta.url), "utf8"));

const session = {
  accessToken: "authenticated-demo-token",
  user: { id: "32000000-0000-4000-8000-000000000003", displayName: "Synthetic Clinician" },
  organization: { id: "32000000-0000-4000-8000-000000000001", name: "OpenTriage Synthetic EMS" },
  startedAt: "2026-09-03T08:00:00.000Z",
  expiresAt: "2026-09-03T22:00:00.000Z",
  capabilities: ["clinical:document", "clinical:demo"]
};

function transactional(manager, isolations = []) {
  return { transaction(first, second) {
    const work = typeof first === "function" ? first : second;
    if (typeof first === "string") isolations.push(first);
    return work(manager);
  } };
}

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

test("a generated assignment keeps fractional operational times offset-aware and browser-parseable", () => {
  const replacement = syntheticReplacementPayload(
    dispatchSample,
    "SYN-20260913-001",
    new Date("2026-09-13T07:52:33.520Z"),
    "52000000-0000-4000-8000-000000000100",
  );
  const timestamps = [replacement.sentAt, ...replacement.groups.flatMap((group) => group.instances)
    .flatMap((instance) => instance.elements)
    .filter(({ id }) => id.startsWith("eTimes."))
    .flatMap(({ values }) => values)
    .flatMap(({ value }) => typeof value === "string" ? [value] : [])];

  assert.ok(timestamps.length > 1);
  assert.equal(timestamps.find((value) => value.includes("Z-04:00")), undefined);
  assert.equal(timestamps.find((value) => Number.isNaN(Date.parse(value))), undefined);
  assert.equal(timestamps.find((value) => value.endsWith(".520-04:00")) !== undefined, true);
  assert.deepEqual(validateDispatchAssignment(replacement, dispatchCatalog), {
    status: "applied", canonical: replacement, findings: [],
  });
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
      if (sql.includes("purge_expired_synthetic_records")) return [];
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
  const sessions = { requireCapability: (token, capability) => {
    assert.equal(token, session.accessToken);
    assert.equal(capability, "clinical:document");
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
  assert.deepEqual(result.mediaPolicy, {
    reportMediaAllowanceBytes: 50 * 1024 * 1024,
    settingsRevision: 1,
  });
  assert.deepEqual(queries[1].parameters?.slice(0, 2), [session.user.id, session.organization.id]);
  assert.match(queries[1].sql, /ca\.status in \('assigned', 'canceled'\)/);
  assert.match(queries[1].sql, /uc\.user_id = \$1/);
});

test("the assigned-call endpoint requires a current clinician session", async () => {
  const controller = new AssignedCallsController({ list: async () => ({ assignedCalls: [], canceledAssignmentIds: [], refreshedAt: "" }) });
  assert.throws(() => controller.list(), (error) => error instanceof UnauthorizedException);
});

test("removing clinical document authority blocks assigned-call access on the next request despite retained admin access", async () => {
  let canDocument = true;
  let queries = 0;
  const remainingCapabilities = ["admin-dashboard:read"];
  const dataSource = { query: async () => { queries += 1; return []; } };
  const sessions = { requireCapability: async (_token, capability) => {
    assert.equal(capability, "clinical:document");
    assert.deepEqual(remainingCapabilities, ["admin-dashboard:read"]);
    if (!canDocument) throw new UnauthorizedException("The requested capability is required");
    return session;
  } };
  const service = new AssignedCallsService(dataSource, sessions);

  await service.list(session.accessToken);
  assert.equal(queries, 3);
  canDocument = false;
  await assert.rejects(service.list(session.accessToken), UnauthorizedException);
  await assert.rejects(
    service.open(session.accessToken, "32000000-0000-4000-8000-000000000011"),
    UnauthorizedException,
  );
  assert.equal(queries, 3, "an old unit assignment must not be queried after authority is removed");
});

test("generation context returns every eligible active unit and only counts unopened synthetic calls", async () => {
  const queries = [];
  const service = new AssignedCallsService({ query: async (sql, parameters) => {
    queries.push({ sql: sql.replace(/\s+/g, " "), parameters });
    if (sql.includes("from app_identity.unit_clinician")) return [
      { id: "unit-1", call_sign: "Medic 1", name: "First", agency_time_zone: "America/New_York" },
      { id: "unit-2", call_sign: "Medic 2", name: "Second", agency_time_zone: "America/New_York" }
    ];
    return [{ exists: true }];
  } }, {
    requireCapability: async (token, capability) => {
      assert.equal(token, session.accessToken);
      assert.ok(["clinical:document", "clinical:demo"].includes(capability));
      return session;
    }
  });

  const context = await service.syntheticGenerationContext(session.accessToken);

  assert.deepEqual(context, {
    eligibleUnits: [
      { id: "unit-1", callSign: "Medic 1", name: "First" },
      { id: "unit-2", callSign: "Medic 2", name: "Second" }
    ],
    hasUnopenedCall: true
  });
  assert.match(queries[0].sql, /uc\.user_id = \$1.*ou\.active/);
  assert.deepEqual(queries[0].parameters, [session.user.id, session.organization.id]);
  assert.match(queries[1].sql, /from clinical\.call_assignment/);
  assert.match(queries[1].sql, /synthetic_generated_by = \$2/);
  assert.match(queries[1].sql, /status = 'assigned'/);
  assert.doesNotMatch(queries[1].sql, /from clinical\.report/);
});

test("opening and retrying one assignment creates one draft without an automatic replacement", async () => {
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
    synthetic_generated_by: session.user.id,
    dispatch_receipt_id: null,
    default_form_id: "32000000-0000-4000-8000-000000000007"
  };
  const reports = new Map();
  const writes = [];
  const isolations = [];
  let patientInsertParameters = null;
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("for update of ca")) return [assignment];
    if (normalized.includes("active_configuration_bundle")) {
      return [{ id: "latest-published-version", catalog_release_id: "catalog-release",
        validation_version_id: "validation-version", form_definition_sha256: "a".repeat(64),
        catalog_artifact_sha256: "b".repeat(64), validation_compiled_sha256: "c".repeat(64) }];
    }
    if (normalized.includes("select canonical_definition from forms.form_version")) return [{ canonical_definition: {
      schemaVersion: 1, sections: [{ key: "response", fields: [{ key: "record", source: { kind: "nemsis", elementId: "eRecord.01" }, required: true }] }]
    } }];
    if (normalized.includes("from app_identity.agency_demographic_version")) return [{ id: "agency-version" }];
    if (normalized.includes("insert into clinical.report")) {
      writes.push("report");
      reports.set(parameters[0], {
        id: parameters[0], documenting_user_id: parameters[7], form_version_id: parameters[5],
        catalog_release_id: parameters[6], revision: "0", status: "draft", synthetic: true
      });
      return [];
    }
    if (normalized.includes("insert into clinical.group_instance")) return [];
    if (normalized.includes("select element_id, agency_required")) return [{
      element_id: "eRecord.01", agency_required: true, min_occurs: 0, max_occurs: 1,
      nillable: false, supports_not_values: false, supports_pertinent_negatives: false
    }];
    if (normalized.includes("from catalog.value_set_element")) return [{
      element_id: "eRecord.01", code: "configured", code_system: "urn:test", label: "Configured choice",
      terminology_version: "2026-09-03T00:00:00.000Z"
    }];
    if (normalized.includes("from catalog.element_definition")) return [{
      element_id: "eRecord.01", element_identity_id: "record-identity", base_datatype: "string", analytical_repeatable: false, identifying: false
    }];
    if (normalized.includes("insert into clinical.element_occurrence")) return [];
    if (normalized.includes("insert into clinical.patient")) {
      writes.push("patient");
      patientInsertParameters ??= parameters;
      return [];
    }
    if (normalized.includes("update clinical.call_assignment")) {
      assignment.status = "opened";
      assignment.report_id = parameters[1];
      return [];
    }
    if (normalized.includes("from clinical.report where")) return [reports.get(parameters[0])];
    if (normalized.includes("join forms.form_version")) return [{
      id: parameters[0], created_at: "2026-09-03T12:00:00.000Z", updated_at: "2026-09-03T12:00:00.000Z",
      form_id: "form", form_version: 1, catalog_standard: "NEMSIS", catalog_version: "3.5.1", catalog_dataset: "EMSDataSet"
    }];
    if (normalized.includes("from clinical.group_instance")) return [];
    if (normalized.includes("from clinical.element_occurrence")) return [];
    if (normalized.includes("from clinical.dispatch_conflict")) return [];
    if (normalized.includes("from clinical.report_note")) return [];
    if (normalized.includes("from clinical.report_photo_note")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const dataSource = { ...transactional(manager, isolations), query: manager.query };
  const sessions = { requireCapability: (token, capability) => {
    assert.equal(token, session.accessToken);
    assert.equal(capability, "clinical:document");
    return session;
  } };
  const controller = new AssignedCallsController(new AssignedCallsService(dataSource, sessions));

  const opened = await controller.open(assignment.id, `Bearer ${session.accessToken}`);
  const retried = await controller.open(assignment.id, `Bearer ${session.accessToken}`);

  assert.equal(opened.report.id, retried.report.id);
  assert.equal(opened.report.documentingUserId, session.user.id);
  assert.equal(opened.report.formVersionId, "latest-published-version");
  assert.deepEqual(opened.report.mediaPolicy, {
    reportMediaAllowanceBytes: 50 * 1024 * 1024,
    settingsRevision: 1,
  });
  assert.equal(opened.report.clinicalForm.definition.sections[0].fields[0].source.elementId, "eRecord.01");
  assert.equal(opened.report.clinicalForm.catalogFields["eRecord.01"].agencyRequired, true);
  assert.deepEqual(opened.report.clinicalForm.catalogFields["eRecord.01"].codeChoices.map(({ code, label }) => ({ code, label })), [
    { code: "configured", label: "Configured choice" }
  ]);
  assert.equal(opened.report.document.encounter.id, opened.report.id);
  assert.equal(opened.report.agencyTimeZone, "America/New_York");
  assert.equal(opened.report.demoMutable, true);
  assert.deepEqual(opened.report.dispatchConflicts, []);
  assert.equal(opened.replacementAssignment, null);
  assert.equal(retried.replacementAssignment, null);
  assert.deepEqual(writes, ["patient", "report"]);

  const [patientId, organizationId, pseudonymousKey, pseudonymousKeyVersion] = patientInsertParameters;
  const patientKeyConfig = patientKeyConfigFromEnvironment(process.env);
  assert.equal(organizationId, session.organization.id);
  assert.equal(pseudonymousKeyVersion, patientKeyConfig.keyVersion);
  assert.equal(pseudonymousKey, derivePatientKey(patientKeyConfig, organizationId, patientId));
  assert.match(pseudonymousKey, /^[a-f0-9]{64}$/);
  assert.notEqual(pseudonymousKey, createHash("sha256").update(`synthetic-assignment:${assignment.id}`).digest("hex"));
  assert.deepEqual(isolations, ["REPEATABLE READ", "REPEATABLE READ"]);
});

test("Clinical Demo generation ignores ordinary calls, creates once, reuses per user and unit, and audits safe facts", async () => {
  const unitId = "32000000-0000-4000-8000-000000000010";
  let generated;
  const audits = [];
  const writes = [];
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("pg_advisory_xact_lock")) return [];
    if (normalized.includes("from app_identity.unit_clinician") && normalized.includes("ou.id = $3")) return [{
      id: unitId, call_sign: "Medic 32", name: "Medic 32", agency_time_zone: "America/New_York"
    }];
    if (normalized.includes("from clinical.call_assignment ca") && normalized.includes("synthetic_generated_by")) {
      assert.match(normalized, /ca\.synthetic and ca\.status = 'assigned'/);
      return generated ? [generated] : [];
    }
    if (normalized.includes("insert into clinical.dispatch_receipt")) { writes.push("receipt"); return []; }
    if (normalized.includes("insert into clinical.incident")) { writes.push("incident"); return []; }
    if (normalized.includes("insert into clinical.call_assignment")) {
      writes.push("assignment");
      assert.match(normalized, /synthetic_generated_by/);
      const expiresAt = new Date(Date.parse(parameters[5]) + 24 * 60 * 60 * 1_000).toISOString();
      generated = {
        id: parameters[0], call_number: parameters[4], unit_id: parameters[2], call_sign: "Medic 32",
        dispatched_at: parameters[5], dispatch_reason: parameters[6], dispatch_priority_code: "2305003",
        dispatch_priority_display: "Emergent", chief_complaint: null, agency_time_zone: "America/New_York",
        expires_at: expiresAt, status: "assigned"
      };
      return [{ created_at: parameters[5], expires_at: expiresAt }];
    }
    if (normalized.includes("insert into clinical_audit.synthetic_generation_event")) {
      audits.push(parameters);
      return [];
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const sessions = {
    assertCsrf: async (token, csrf) => {
      assert.equal(token, session.accessToken);
      assert.equal(csrf, "csrf-token");
    },
    requireCapability: async (token, capability) => {
      assert.equal(token, session.accessToken);
      assert.ok(["clinical:document", "clinical:demo"].includes(capability));
      return session;
    }
  };
  const service = new AssignedCallsService(transactional(manager), sessions);
  const now = new Date("2026-09-03T12:00:00.000Z");

  const created = await service.generateSynthetic(session.accessToken, "csrf-token", unitId, now);
  const reused = await service.generateSynthetic(session.accessToken, "csrf-token", unitId, now);

  assert.equal(created.reused, false);
  assert.equal(reused.reused, true);
  assert.equal(reused.assignment.id, created.assignment.id);
  assert.match(created.assignment.callNumber, /^DEMO-20260903-[0-9A-F]{8}$/);
  assert.deepEqual(writes, ["receipt", "incident", "assignment"]);
  assert.deepEqual(audits.map((parameters) => parameters.slice(0, 5)), [
    [session.organization.id, session.user.id, unitId, created.assignment.id, "synthetic_call.generate"],
    [session.organization.id, session.user.id, unitId, created.assignment.id, "synthetic_call.reuse"]
  ]);
  assert.equal(JSON.stringify(audits).includes("patient"), false);
});

test("generation rejects missing current Clinical Demo authority before any database mutation", async () => {
  let queried = false;
  const manager = { query: async () => { queried = true; return []; } };
  const service = new AssignedCallsService(transactional(manager), {
    assertCsrf: async () => undefined,
    requireCapability: async (_token, capability) => {
      if (capability === "clinical:document") return session;
      throw new UnauthorizedException("The requested capability is required");
    }
  });

  await assert.rejects(
    service.generateSynthetic(session.accessToken, "csrf-token", "32000000-0000-4000-8000-000000000010"),
    (error) => error instanceof UnauthorizedException
  );
  assert.equal(queried, false);
});

test("generation creates an unopened call even when the clinician has another draft report", async () => {
  let generated;
  const manager = { query: async (sql, parameters) => {
    const normalized = sql.replace(/\s+/g, " ");
    if (normalized.includes("pg_advisory_xact_lock")) return [];
    if (normalized.includes("from app_identity.unit_clinician")) return [{
      id: "32000000-0000-4000-8000-000000000010", call_sign: "Medic 32", name: "Medic 32",
      agency_time_zone: "America/New_York"
    }];
    if (normalized.includes("from clinical.call_assignment ca") && normalized.includes("synthetic_generated_by")) return [];
    if (normalized.includes("insert into clinical.dispatch_receipt")) return [];
    if (normalized.includes("insert into clinical.incident")) return [];
    if (normalized.includes("insert into clinical.call_assignment")) {
      generated = {
        id: parameters[0], call_number: parameters[4], unit_id: parameters[2], call_sign: "Medic 32",
        dispatched_at: parameters[5], dispatch_reason: parameters[6], dispatch_priority_code: "2305003",
        dispatch_priority_display: "Emergent", chief_complaint: null, agency_time_zone: "America/New_York",
        expires_at: new Date(Date.parse(parameters[5]) + 86_400_000).toISOString(), status: "assigned"
      };
      return [{ created_at: parameters[5], expires_at: generated.expires_at }];
    }
    if (normalized.includes("insert into clinical_audit.synthetic_generation_event")) return [];
    throw new Error(`Unexpected SQL: ${normalized}`);
  } };
  const service = new AssignedCallsService(transactional(manager), {
    assertCsrf: async () => undefined,
    requireCapability: async () => session
  });

  const created = await service.generateSynthetic(
    session.accessToken,
    "csrf-token",
    "32000000-0000-4000-8000-000000000010",
    new Date("2026-09-13T08:30:00.000Z")
  );

  assert.equal(created.reused, false);
  assert.equal(created.assignment.id, generated.id);
});

test("a serialization failure while opening an assignment surfaces as a retriable conflict, not a raw 500", async () => {
  const dataSource = {
    transaction: async () => {
      const error = new Error("could not serialize access due to concurrent update");
      error.code = "40001";
      throw error;
    }
  };
  const sessions = { requireCapability: (token, capability) => {
    assert.equal(token, session.accessToken);
    assert.equal(capability, "clinical:document");
    return session;
  } };
  const service = new AssignedCallsService(dataSource, sessions);

  await assert.rejects(
    service.open(session.accessToken, "32000000-0000-4000-8000-000000000011"),
    (error) => error instanceof ConflictException && error.getStatus() === 409
  );
});

test("a not-found error while opening an assignment keeps its original status instead of becoming a conflict", async () => {
  const dataSource = transactional({ query: async () => [] });
  const sessions = { requireCapability: (token, capability) => {
    assert.equal(token, session.accessToken);
    assert.equal(capability, "clinical:document");
    return session;
  } };
  const service = new AssignedCallsService(dataSource, sessions);

  await assert.rejects(
    service.open(session.accessToken, "32000000-0000-4000-8000-000000000011"),
    (error) => error instanceof NotFoundException && error.getStatus() === 404
  );
});
