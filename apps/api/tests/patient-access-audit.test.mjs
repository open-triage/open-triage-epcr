import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { auditCategories, auditDumpSources } from "@open-triage/contracts";
import { recordPatientAccess } from "../dist/reports/patient-access-audit.js";
import { DraftReportService } from "../dist/reports/draft-report.service.js";
import { AuditService, validateAuditQuery } from "../dist/admin/audit.service.js";

const input = { organizationId: randomUUID(), actorId: randomUUID(), reportIds: [randomUUID()],
  action: "report.read", careProcess: "documentation" };

test("patient access requires a persisted event for every returned report and propagates storage failure", async () => {
  for (const recorded of [0, undefined]) await assert.rejects(recordPatientAccess({ query: async () => [{ recorded }] }, input), { status: 503 });
  const failure = new Error("storage unavailable");
  await assert.rejects(recordPatientAccess({ query: async () => { throw failure; } }, input), failure);
  let values;
  await recordPatientAccess({ query: async (_sql, args) => { values = args; return [{ recorded: 1 }]; } },
    { ...input, reportIds: [...input.reportIds, ...input.reportIds], token: "secret", narrative: "private content" });
  assert.deepEqual(values[3], input.reportIds);
  assert.doesNotMatch(JSON.stringify(values), /secret|private content/);
});

test("both fresh and conditional active-report reads fail closed when audit storage fails", async () => {
  const session = { user: { id: input.actorId }, organization: { id: input.organizationId } };
  for (const etag of [undefined, '"report-2-dispatch-0-settings-1"']) {
    let attempted = false;
    const service = new DraftReportService({ transaction: async (_isolation, work) => work({ query: async (sql) => {
      if (sql.includes("with recorded_access")) { attempted = true; throw new Error("audit unavailable"); }
      if (sql.includes("select r.revision")) return [{ revision: 2, dispatch_revision: null, media_settings_revision: 1 }];
      throw new Error("clinical content must not be released");
    } }) }, { requireCapability: async () => session });
    await assert.rejects(service.active("secret", input.reportIds[0], etag), /audit unavailable/);
    assert.equal(attempted, true);
  }
});

const query = { category: "authentication", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" };
test("audit filters reject injected source names, invalid dates, unbounded ranges and malformed cursors", () => {
  assert.equal(validateAuditQuery(query).category, "authentication");
  for (const extra of [{ category: "authentication;drop table x" }, { from: "bad" }, { to: query.from },
    { to: "2027-01-01T00:00:00Z" }, { from: "2026-02-31T00:00:00Z" }, { actorId: "x' or true" }, { organizationId: randomUUID() },
    { cursor: Buffer.from(JSON.stringify({ time: query.from, source: "x;drop", id: "1" })).toString("base64url") },
    { cursor: Buffer.from(JSON.stringify({ time: query.from, source: "app_identity.authentication_event", id: "1" })).toString("base64url") }]) {
    assert.throws(() => validateAuditQuery({ ...query, ...extra }), { status: 400 });
  }
});

test("audit browsing and user lookup require audit authority before querying", async () => {
  const database = { transaction: async (_isolation, work) => work({ query: async () => assert.fail("unauthorized query") }) };
  const denied = new AuditService(database, { requireCapability: async (_token, capability) => {
    assert.equal(capability, "audit:read"); throw Object.assign(new Error("denied"), { status: 403 });
  } });
  await assert.rejects(denied.list("secret", query), { status: 403 });
  await assert.rejects(denied.users("secret", {}), { status: 403 });
});

test("audit user choices reject scope overrides and malformed paging before accessing the database", async () => {
  const service = new AuditService({ transaction: async () => assert.fail("invalid user query reached the database") }, {});
  for (const input of [{ organizationId: randomUUID() }, { search: "anything" }, { cursor: "" }, { cursor: ["invalid"] },
    { cursor: Buffer.from(JSON.stringify({ name: "User", id: "injected'" })).toString("base64url") },
    { cursor: Buffer.from(JSON.stringify({ name: "x".repeat(201), id: randomUUID() })).toString("base64url") }]) {
    await assert.rejects(service.users("secret", input), { status: 400 });
  }
});

test("payload inspections validate source IDs, require audit access, and fail before returning unlogged content", async () => {
  let authorized = true, capabilities = ["audit:read"], authority = {}, reads = 0, failWrite = false;
  const payload = { submission: { description: "Fixture full report" } };
  const service = new AuditService({ transaction: async (_level, work) => work({ query: async (sql) => {
    if (sql.includes("select scoped_organization_ids")) { reads++; return [{ payload: { execution: {} }, captured: true, organization_ids: [] }]; }
    if (sql.includes("select jsonb_build_object")) { reads++; return [{ payload }]; }
    if (sql.includes("insert into clinical_audit.audit_read_event") && failWrite) throw new Error("audit unavailable");
    return [];
  } }) }, { requireCapability: async (_token, capability) => {
    assert.equal(capability, "audit:read");
    if (!authorized) throw Object.assign(new Error("denied"), { status: 403 });
    return { user: { id: input.actorId }, organization: { id: input.organizationId }, capabilities, ...authority };
  } });
  for (const [source,id] of [["arbitrary.table",input.reportIds[0]],["feedback.submission","-1"],["feedback.submission","1"],
    ["feedback.review_event","9999999999999999999"],["clinical_audit.analytics_access_event","1"]])
    await assert.rejects(service.payload("secret",source,id), { status: 400 });
  for (const source of auditDumpSources) {
    authorized = false;
    await assert.rejects(service.payload("secret", source, input.reportIds[0]), { status: 403 });
    authorized = true;
    for (const grants of [["audit:read"], ["audit:read", "review:identifying"], ["audit:read", "audit:read-identifying"]]) {
      capabilities = grants;
      await assert.rejects(service.payload("secret", source, input.reportIds[0]), { status: 403 });
    }
    capabilities = ["audit:read", "audit:identifying"];
    for (const key of ["installationOwner", "installationSuperadmin"]) {
      authority = { [key]: true };
      await assert.rejects(service.payload("secret", source, input.reportIds[0]), { status: 403 });
    }
    authority = {};
  }
  assert.equal(reads, 0);
  for (const source of auditDumpSources) {
    failWrite = false;
    assert.deepEqual(await service.payload("secret", source, input.reportIds[0]),
      source === "clinical_audit.analytics_access_event"
        ? { kind: "analytics", payload: { execution: { organizations: [] } }, requestCaptured: true }
        : { kind: "feedback", payload });
    failWrite = true;
    await assert.rejects(service.payload("secret", source, input.reportIds[0]), /audit unavailable/);
  }
});

test("audit actor lookup is bounded to unique account IDs on the visible page", async () => {
  const nextPageActor = randomUUID();
  const rows = Array.from({ length: 51 }, (_, index) => ({ event_id: String(index), source: "feedback.review_event",
    occurred_at: query.from, cursor_time: query.from, actor_id: index === 50 ? nextPageActor
      : index === 1 ? "operator-label" : index === 2 ? null : input.actorId,
    action: "feedback.review", target_id: null, outcome: null, patient_id: null,
    access_organization_id: null, care_process: null, resource_id: null, analytics: null }));
  const lookups = [];
  const service = new AuditService({ transaction: async (_level, work) => work({ query: async (sql, values) => {
    if (sql.includes("total_count")) return [{ total_count: "51", skipped_count: "0", snapshot_time: query.to }];
    if (sql.includes("cursor_time")) return rows;
    if (sql.includes("from app_identity.app_user")) {
      lookups.push(values[0]);
      return [{ id: input.actorId, username: "audit.clinician", display_name: "Audit Clinician" }];
    }
    return [];
  } }) }, { requireCapability: async () => ({ user: { id: input.actorId },
    organization: { id: input.organizationId }, capabilities: ["audit:read"] }) });
  const page = await service.list("unused", { ...query, category: "feedback" });
  assert.deepEqual(lookups, [[input.actorId]]);
  assert.equal(page.entries.length, 50);
  assert.ok(page.nextCursor);
  assert.equal(page.entries[0].actorUsername, "audit.clinician");
  assert.equal(page.entries[1].actorId, "operator-label");
  assert.equal(page.entries[1].actorUsername, null);
  assert.equal(page.entries[2].actorId, null);
});

test("audit target resolution uses only typed targets on the visible page and preserves missing targets", async () => {
  const targetId = randomUUID(), lookaheadId = randomUUID();
  const rows = Array.from({ length: 51 }, (_, index) => ({ event_id: String(index),
    source: "app_identity.authentication_event", occurred_at: query.from, cursor_time: query.from,
    actor_id: null, action: "authentication.sign_in", target_kind: "user",
    target_id: index === 50 ? lookaheadId : index === 1 ? null : targetId }));
  let lookups = 0;
  const service = new AuditService({ transaction: async (_level, work) => work({ query: async (sql, values) => {
    if (sql.includes("total_count")) return [{ total_count: "51", skipped_count: "0", snapshot_time: query.to }];
    if (sql.includes("cursor_time")) return rows;
    if (sql.includes("from app_identity.agency_user t")) {
      lookups++;
      assert.deepEqual(values, [input.organizationId, [targetId]]);
      assert.match(sql, /t.organization_id=\$1/);
      return [];
    }
    return [];
  } }) }, { requireCapability: async () => ({ user: { id: input.actorId },
    organization: { id: input.organizationId }, capabilities: ["audit:read"] }) });
  const page = await service.list("unused", query);
  assert.equal(lookups, 1);
  assert.equal(page.entries.length, 50);
  assert.deepEqual(page.entries[0].target, { kind: "user", label: null });
  assert.equal(page.entries[0].targetId, targetId);
  assert.equal(page.entries[1].target, null);
  assert.ok(page.nextCursor);
});

test("audit agency and resource labels resolve only unique references on the visible page", async () => {
  const agency = randomUUID(), missingAgency = randomUUID(), lookahead = randomUUID(), resource = randomUUID();
  const rows = Array.from({ length: 51 }, (_, index) => ({ event_id: String(index),
    source: "clinical_audit.patient_access_event", occurred_at: query.from, cursor_time: query.from,
    actor_id: null, action: "photo.read", target_kind: "report", target_id: null,
    resource_id: index === 50 ? lookahead : resource, access_organization_id: index === 50 ? lookahead : agency,
    analytics: { organizationIds: index === 50 ? [lookahead] : [agency, missingAgency, agency] } }));
  let agencyLookups = 0, resourceLookups = 0;
  const service = new AuditService({ transaction: async (_level, work) => work({ query: async (sql, values) => {
    if (sql.includes("total_count")) return [{ total_count: "51", skipped_count: "0", snapshot_time: query.to }];
    if (sql.includes("cursor_time")) return rows;
    if (sql.includes("from app_identity.organization where")) {
      agencyLookups++; assert.deepEqual(values, [[agency, missingAgency]]);
      return [{ id: agency, name: "Referenced agency" }];
    }
    if (sql.includes("from clinical.report_photo_note t")) {
      resourceLookups++; assert.deepEqual(values, [input.organizationId, [resource]]);
      assert.match(sql, /t.organization_id=\$1/);
      assert.doesNotMatch(sql, /caption|canonical_bytes/);
      return [{ id: resource, kind: "photo", label: null, version: null, occurred_at: query.from }];
    }
    return [];
  } }) }, { requireCapability: async () => ({ user: { id: input.actorId },
    organization: { id: input.organizationId }, capabilities: ["audit:read", "audit:identifying"] }) });
  const page = await service.list("unused", { ...query, category: "patient" });
  assert.equal(agencyLookups, 1); assert.equal(resourceLookups, 1);
  assert.equal(page.entries[0].accessOrganizationName, "Referenced agency");
  assert.deepEqual(page.entries[0].resource, { kind: "photo", label: null, version: null, occurredAt: query.from });
  assert.deepEqual(page.entries[0].analytics.organizations, [
    { id: agency, name: "Referenced agency" }, { id: missingAgency, name: null }, { id: agency, name: "Referenced agency" },
  ]);
  assert.doesNotMatch(JSON.stringify(page.entries), new RegExp(lookahead));
});

test("clinical-value inspection requires both audit levels and fails closed when its patient-access evidence fails", async () => {
  const values = { submittedChanges: { observations: "Fictional clinical value" } };
  let session = { user: { id: input.actorId }, organization: { id: input.organizationId },
    capabilities: ["audit:read", "audit:identifying"] };
  let reads = 0;
  const service = new AuditService({ transaction: async (_level, work) => work({ query: async (sql) => {
    if (sql.includes("select e.report_id")) { reads++; return [{ report_id: input.reportIds[0], values }]; }
    throw new Error("audit unavailable");
  } }) }, { requireCapability: async (_token, capability) => {
    assert.equal(capability, "audit:identifying");
    if (!session.capabilities.includes(capability)) throw Object.assign(new Error("denied"), { status: 403 });
    return session;
  } });
  await assert.rejects(service.clinicalValues("secret", "app_identity.authentication_event", "1"), { status: 400 });
  for (const capabilities of [["audit:read"], ["audit:read", "review:identifying"], ["audit:identifying"], ["audit:read", "audit:read-identifying"]]) {
    session = { ...session, capabilities };
    await assert.rejects(service.clinicalValues("secret", "clinical.report_change", input.reportIds[0]), { status: 403 });
  }
  assert.equal(reads, 0);
  session = { ...session, capabilities: ["audit:read", "audit:identifying"] };
  await assert.rejects(service.clinicalValues("secret", "clinical.report_change", input.reportIds[0]), /audit unavailable/);
  assert.equal(reads, 1);
});

test("audit type selections support blank/all and multiple allowlisted types without accepting ambiguous inputs", () => {
  const { category, ...range } = query;
  assert.deepEqual(validateAuditQuery(range).categories, []);
  assert.deepEqual(validateAuditQuery({ ...range, categories: "" }).categories, []);
  assert.deepEqual(validateAuditQuery({ ...range, categories: "feedback,authentication,feedback" }).categories, ["authentication", "feedback"]);
  assert.deepEqual(validateAuditQuery(query).categories, [category]);
  for (const categories of [null, 1, [], ["feedback"], {}, "unknown", "authentication,", ",", "feedback,unknown", "feedback;select", "x".repeat(257)]) {
    assert.throws(() => validateAuditQuery({ ...range, categories }), { status: 400 });
  }
  assert.throws(() => validateAuditQuery({ ...query, categories: "feedback" }), { status: 400 });
});

test("metadata auditors can select all categories individually or together and every inspection records its scope", async () => {
  const { category, ...range } = query;
  for (const authority of [{}, { installationOwner: true }, { installationSuperadmin: true }]) {
    const calls = [];
    const service = new AuditService({ transaction: async (_level, work) => work({ query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes("total_count")) return [{ total_count: "0", skipped_count: "0", snapshot_time: query.to }];
      return [];
    } }) }, { requireCapability: async () => ({ user: { id: input.actorId }, organization: { id: input.organizationId },
      capabilities: authority.installationOwner || authority.installationSuperadmin ? ["audit:read", "audit:identifying"] : ["audit:read"], ...authority }) });
    for (const categories of [undefined, "", "authentication,patient", ...auditCategories]) {
      calls.length = 0;
      const page = await service.list("fixture", { ...range, categories });
      assert.deepEqual(page.categories, auditCategories);
      const selected = categories ? auditCategories.filter(category => categories.split(",").includes(category)) : auditCategories;
      const read = calls.find(call => call.sql.includes("cursor_time"));
      assert.equal(read.args[0], input.organizationId);
      for (const category of auditCategories) {
        assert.equal(read.sql.includes(`select '${category}'::text category`), selected.includes(category));
      }
      const inspection = calls.find(call => call.sql.includes("insert into clinical_audit.audit_read_event"));
      assert.equal(inspection.args[2], selected.length === 1 ? selected[0] : "combined");
      assert.deepEqual(inspection.args[8], selected);
    }
  }
});

test("general audit UUID search normalizes complete UUIDs and rejects partial, malformed or ambiguous filters", () => {
  const id = "abcdef01-2345-4678-9abc-def012345678";
  assert.equal(validateAuditQuery({ ...query, uuid: id.toUpperCase() }).uuid, id);
  for (const value of ["", "abcdef01", id.slice(0, -1), `${id}%`, "' or true", [id], null, 1]) {
    assert.throws(() => validateAuditQuery({ ...query, uuid: value }), { status: 400 });
  }
  assert.throws(() => validateAuditQuery({ ...query, uuid: id, targetId: id }), { status: 400 });
});

test("audit cursor time bounds reject malformed and impossible timestamps", () => {
  const valid = { time: query.from, source: "app_identity.authentication_event", id: randomUUID(), snapshot: query.to };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  assert.equal(validateAuditQuery({ ...query, cursor: encode(valid) }).after.snapshot, query.to);
  for (const field of ["time", "snapshot"]) for (const value of [null, 1, "bad", "2026-02-31T00:00:00Z", "2026-10-01T99:00:00Z"]) {
    assert.throws(() => validateAuditQuery({ ...query, cursor: encode({ ...valid, [field]: value }) }), { status: 400 });
  }
});
