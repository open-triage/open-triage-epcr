import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { auditCategories } from "@open-triage/contracts";
import { AuditService } from "../dist/admin/audit.service.js";
import { resolveAuditTargets } from "../dist/admin/audit-targets.js";
import { DraftReportService } from "../dist/reports/draft-report.service.js";
import { recordPatientAccess } from "../dist/reports/patient-access-audit.js";
import { recordAnalyticsAccess } from "../dist/review/analytics-access-audit.js";
import { createFeedbackReference, FeedbackService } from "../dist/feedback/feedback.service.js";
import { UnitsService } from "../dist/admin/units.service.js";
import { InstallationEnrollmentService } from "../dist/admin/installation-enrollment.service.js";
import { agencyRequest } from "../dist/sessions/agency-context.js";

if (process.env.REQUIRE_DATABASE_INTEGRATION && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const integration = process.env.DATABASE_URL ? test : test.skip;

integration("installation and unit audit outcomes describe committed changes without inventing successful attempts", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const organizationId = randomUUID(), actorId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'Installation outcome fixture','UTC')`, [organizationId]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$2,'Installation Auditor')`, [actorId, organizationId]);
  const manager = { query: async (sql, values) => {
    const result = await client.query(sql, values);
    return /^\s*(update|delete)\b/i.test(sql) ? [result.rows, result.rowCount] : result.rows;
  } };
  let serial = 0, canWrite = true;
  const database = { ...manager, manager, transaction: async (first, second) => {
    const savepoint = `installation_audit_${++serial}`;
    await client.query(`savepoint ${savepoint}`);
    try {
      const result = await (typeof first === "function" ? first : second)(manager);
      await client.query(`release savepoint ${savepoint}`);
      return result;
    } catch (error) {
      await client.query(`rollback to savepoint ${savepoint}`);
      await client.query(`release savepoint ${savepoint}`);
      throw error;
    }
  } };
  const sessions = { requireCapability: async (_token, capability) => {
    assert.ok(["settings:write", "audit:read"].includes(capability));
    if (capability === "settings:write" && !canWrite) throw Object.assign(new Error("denied"), { status: 403 });
    return { user: { id: actorId }, organization: { id: organizationId }, capabilities: ["audit:read"] };
  } };
  const units = new UnitsService(database, sessions);
  const installations = new InstallationEnrollmentService(database, sessions, { allowsOrigin: async () => true });
  const audit = new AuditService(database, sessions);
  const run = work => agencyRequest.run({ origin: "https://installation-outcomes.example" }, work);
  await client.query("set local role open_triage_api_runtime");
  const unit = await units.save("fixture", null, { name: "First unit", callSign: "OUTCOME-1", active: true });
  const secondUnit = await units.save("fixture", null, { name: "Second unit", callSign: "OUTCOME-2", active: true });
  const renamed = await units.save("fixture", unit.id, { name: "Renamed unit", callSign: unit.callSign, active: true, expectedRevision: 1 });
  await units.save("fixture", unit.id, { name: renamed.name, callSign: unit.callSign, active: false, expectedRevision: 2 });
  await units.save("fixture", unit.id, { name: renamed.name, callSign: unit.callSign, active: true, expectedRevision: 3 });

  const issued = await run(() => installations.issue("fixture", unit.id));
  const enrolled = await run(() => installations.consume({ token: issued.token, name: "Outcome browser", confirmInstallation: true }, "A".repeat(43)));
  const replacement = await run(() => installations.issue("fixture", secondUnit.id));
  const reassigned = await run(() => installations.consume({ token: replacement.token, name: "Reassigned browser",
    confirmInstallation: true, reassign: true }, enrolled.credential));
  await run(() => installations.revoke("fixture", secondUnit.id, reassigned.installation.id));

  const query = { category: "installations", from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 86400_000).toISOString() };
  const completed = await audit.list("fixture", query);
  assert.equal(completed.entries.length, 11);
  assert.equal(completed.entries.filter(row => row.source === "app_identity.operational_unit_event").length, 5);
  assert.deepEqual(new Set(completed.entries.map(row => row.action)), new Set([
    "unit.change", "enrollment-issued", "installation-enrolled", "installation-reassigned", "installation-revoked",
  ]));
  assert.ok(completed.entries.every(row => row.outcome === "succeeded"));
  assert.ok(completed.entries.some(row => row.action === "installation-enrolled" && row.targetId === enrolled.installation.id),
    "an enrollment remains successful after its registration is revoked by reassignment");
  for (const secret of [issued.token, replacement.token, enrolled.credential, reassigned.credential])
    assert.equal(JSON.stringify(completed).includes(secret), false);

  await assert.rejects(units.save("fixture", null, { name: "Duplicate", callSign: unit.callSign, active: true }), { status: 409 });
  await assert.rejects(units.save("fixture", unit.id, { name: "Stale", callSign: unit.callSign, active: true, expectedRevision: 1 }), { status: 409 });
  await assert.rejects(run(() => installations.consume({ token: issued.token, name: "Replay", confirmInstallation: true }, "B".repeat(43))), { status: 401 });
  await assert.rejects(run(() => installations.revoke("fixture", unit.id, reassigned.installation.id)), { status: 404 });
  canWrite = false;
  await assert.rejects(run(() => installations.issue("fixture", unit.id)), { status: 403 });
  canWrite = true;
  await run(() => installations.revoke("fixture", secondUnit.id, reassigned.installation.id));
  assert.deepEqual((await audit.list("fixture", query)).entries, completed.entries,
    "rejected changes and repeated revocation must not add success events");
});

integration("audit outcomes preserve failures and distinguish accepted, unapplied, recovered and completed history", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const report = (await client.query(`select r.* from clinical.report r where r.status='draft'
    and exists(select 1 from clinical.signed_snapshot s join clinical.report signed on signed.id=s.report_id
      where signed.organization_id=r.organization_id) limit 1`)).rows[0];
  assert.ok(report, "The preceding API integration suite must seed draft and signed reports");
  const organizationId = report.organization_id, actorId = report.documenting_user_id;
  const signed = (await client.query(`select s.* from clinical.signed_snapshot s
    join clinical.report r on r.id=s.report_id where r.organization_id=$1 limit 1`, [organizationId])).rows[0];
  const expected = new Map();
  // Table/column identifiers are fixture constants, never request input.
  const add = async (table, fields, outcome) => {
    const keys = Object.keys(fields);
    const row = (await client.query(`insert into ${table} as fixture (${keys.join(",")})
      values (${keys.map((_, index) => `$${index + 1}`).join(",")})
      returning coalesce(to_jsonb(fixture)->>'audit_id',to_jsonb(fixture)->>'id') id`, Object.values(fields))).rows[0];
    expected.set(`${table}:${row.id}`, outcome);
    return row.id;
  };
  const attributed = { organization_id: organizationId, actor_id: actorId };
  await add("app_identity.authentication_event", { ...attributed, action: "authentication.sign_in", result: "failed" }, "failed");
  await add("app_identity.authorization_event", { ...attributed, action: "role.package_preview",
    target_type: "role_package", target_key: "outcome-fixture", details: {} }, "succeeded");
  await add("app_identity.organization_event", { ...attributed, action: "agency.update" }, "succeeded");

  for (const [event_type, outcome] of [["ciphertext_written", "recorded"], ["recovery_succeeded", "succeeded"],
    ["recovery_unavailable", "unavailable"], ["key_expired", "expired"], ["policy_shortened", "applied"]]) {
    await add("offline_recovery.event", { organization_id: organizationId, report_id: report.id,
      recovery_handle: randomUUID(), event_type }, outcome);
  }
  await add("offline_recovery.key_lifecycle_event", { organization_id: organizationId, report_id: report.id,
    event_type: "grant_denial", actor_kind: "clinician", actor_user_id: actorId, policy_version: "offline-recovery-v1",
    outcome: "denied", reason_code: "unavailable" }, "denied");
  await add("offline_recovery.report_recovery_event", { organization_id: organizationId, report_id: report.id,
    user_id: actorId, action: "consume", outcome: "denied", reason: "grant_expired" }, "denied");

  let prior = (await client.query(`select report_sequence,event_hash from clinical_audit.event
    where report_id=$1 order by report_sequence desc limit 1`, [report.id])).rows[0];
  for (const [action, outcome] of [["sign", "succeeded"], ["amend", "succeeded"], ["unknown-historical-action", null]]) {
    const sequence = Number(prior?.report_sequence ?? 0) + 1, hash = "a".repeat(64);
    await add("clinical_audit.event", { report_id: report.id, report_sequence: sequence, actor_id: actorId,
      action, target_type: "report", target_id: report.id, event_hash: hash, previous_hash: prior?.event_hash ?? null }, outcome);
    prior = { report_sequence: sequence, event_hash: hash };
  }
  const revision = Number((await client.query("select coalesce(max(revision),0)+1 n from clinical.report_change where report_id=$1", [report.id])).rows[0].n);
  const command = randomUUID();
  await add("clinical.report_change", { report_id: report.id, revision, idempotency_key: command,
    author_id: actorId, changes: { value: "PRIVATE_OUTCOME_FIXTURE" } }, "accepted");
  await add("clinical_audit.draft_reconciliation", { report_id: report.id, target_type: "occurrence", target_id: randomUUID(),
    losing_value: { value: "PRIVATE_OUTCOME_FIXTURE" }, losing_author_id: actorId,
    losing_server_received_time: new Date(), losing_base_revision: 0, winning_revision: revision,
    winning_idempotency_key: command, winning_author_id: actorId, winning_server_received_time: new Date(),
    winning_base_revision: 0, resolution: "server-receipt-order" }, "reconciled");
  await add("clinical_audit.post_signature_audit_note", { report_id: signed.report_id, idempotency_key: randomUUID(),
    target_type: "occurrence", target_id: randomUUID(), attempted_change: { value: "PRIVATE_OUTCOME_FIXTURE" },
    author_id: actorId, server_received_time: new Date(), expected_revision: 0, signed_revision: signed.signed_revision,
    signed_snapshot_id: signed.id, signed_canonical_sha256: signed.canonical_sha256 }, "not-applied");

  const criterion = randomUUID();
  await client.query("insert into validation.rule_identity(id,organization_id,created_by) values($1,$2,$3)", [criterion, organizationId, actorId]);
  const item = (await client.query(`insert into clinical.review_item
    (organization_id,report_id,criterion_id,priority,first_matched_at) values($1,$2,$3,'low',now()) returning id`,
  [organizationId, report.id, criterion])).rows[0].id;
  for (const [index, action] of ["claimed", "assigned", "routed", "recovered"].entries()) {
    await add("clinical.review_assignment_history", { ...attributed, item_id: item, command_id: randomUUID(), item_version: index + 1,
      action, assignee_id: action === "recovered" ? null : actorId }, action === "recovered" ? "unassigned" : "assigned");
  }
  for (const [index, [action, outcome]] of [["detected", "opened"], ["resolved-by-signing", "resolved"],
    ["closed-exceptionally", "closed"], ["signed-after-exception", "reconciled"]].entries()) {
    await add("clinical.review_overdue_history", { ...attributed, item_id: item, item_version: index, action,
      ...(action === "closed-exceptionally" ? { command_id: randomUUID(), reason_code: "administrative-exception" } : {}) }, outcome);
  }
  for (const [index, reason] of ["configured", "ineligible"].entries()) {
    await add("clinical.review_criterion_route_history", { ...attributed, criterion_id: criterion, command_id: randomUUID(),
      route_version: index + 1, route: reason === "configured" ? "named" : "unassigned",
      named_user_id: reason === "configured" ? actorId : null, reason }, reason === "configured" ? "succeeded" : "unassigned");
  }
  const analysis = (await client.query(`insert into clinical.review_saved_analysis
    (organization_id,owner_id,name,definition) values($1,$2,'Outcome analysis','{}') returning id`, [organizationId, actorId])).rows[0].id;
  for (const [index, action] of ["created", "updated"].entries()) await add("clinical.review_saved_analysis_history", {
    ...attributed, analysis_id: analysis, command_id: randomUUID(), version: index + 1, action,
    name: "Outcome analysis", definition: {}, requested_definition: {}, shared: false,
  }, "succeeded");
  for (const [table, version, settings] of [
    ["clinical.review_overdue_policy_history", "version", { deadline_hours: 24 }],
    ["clinical.review_amendment_policy_history", "policy_version", { clearance: "confirm" }],
  ]) {
    const next = (await client.query(`select coalesce(max(${version}),0)+1 n from ${table} where organization_id=$1`, [organizationId])).rows[0].n;
    await add(table, { ...attributed, command_id: randomUUID(), [version]: next, ...settings }, "succeeded");
  }
  const unit = (await client.query("select id from app_identity.operational_unit where organization_id=$1 limit 1", [organizationId])).rows[0];
  for (const action of ["synthetic_call.generate", "synthetic_call.reuse"]) await add("clinical_audit.synthetic_generation_event",
    { ...attributed, unit_id: unit.id, assignment_id: randomUUID(), action }, "succeeded");
  for (const action of ["populate", "clear", "delete"]) await add("clinical_audit.synthetic_draft_mutation_event", {
    ...attributed, report_id: report.id, action: `synthetic_draft.${action}`, target_count: 0,
    command_id: action === "delete" ? null : randomUUID(), report_revision: action === "delete" ? null : revision,
  }, "succeeded");

  await client.query("set local role open_triage_api_runtime");
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const audit = new AuditService({ transaction: async (_level, work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: actorId }, capabilities: ["audit:read", "audit:identifying"] }),
  });
  const found = new Map();
  for (const category of auditCategories) {
    let cursor;
    do {
      const page = await audit.list("fixture", { category, from: new Date(Date.now() - 86400_000).toISOString(),
        to: new Date(Date.now() + 86400_000).toISOString(), ...(cursor ? { cursor } : {}) });
      for (const entry of page.entries) {
        assert.match(entry.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        found.set(`${entry.source}:${entry.id}`, entry.outcome);
        if (entry.action !== "unknown-historical-action") assert.notEqual(entry.outcome, null, `${entry.source}: ${entry.action}`);
      }
      assert.doesNotMatch(JSON.stringify(page), /PRIVATE_OUTCOME_FIXTURE/);
      cursor = page.nextCursor;
    } while (cursor);
  }
  for (const [key, outcome] of expected) {
    assert.ok(found.has(key), `Missing ${key}`);
    assert.equal(found.get(key), outcome, key);
  }
  for (const source of ["clinical_audit.event", "clinical.report_change", "clinical_audit.draft_reconciliation", "clinical_audit.post_signature_audit_note"]) {
    const key = [...expected.keys()].find(key => key.startsWith(`${source}:`));
    const id = key.slice(source.length + 1);
    const result = await audit.clinicalValues("fixture", source, id);
    assert.ok(Object.keys(result.values).length > 0, `${source} values resolve by UUID`);
    const inspection = (await audit.list("fixture", { category: "audit", targetId: id,
      from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 86400_000).toISOString() })).entries[0];
    assert.equal(inspection.targetId, id);
    assert.equal(inspection.target.kind, "auditEvent");
  }
});

integration("feedback audit includes accepted submissions and reviews without duplicates, content or cross-agency rows", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const organizationId = randomUUID(), otherOrganizationId = randomUUID();
  const senderId = randomUUID(), reviewerId = randomUUID(), outsideId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'Feedback audit fixture','UTC'),($2,'Other feedback agency','UTC')`, [organizationId,otherOrganizationId]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$4,'Feedback Sender'),($2,$4,'Feedback Reviewer'),($3,$5,'Outside Sender')`,
  [senderId,reviewerId,outsideId,organizationId,otherOrganizationId]);
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const database = { transaction: async (first, second) => (typeof first === "function" ? first : second)(manager) };
  let session = { user: { id: senderId, displayName: "Feedback Sender" },
    organization: { id: organizationId, name: "Feedback audit fixture" }, capabilities: ["audit:read"] };
  const sessions = { get: async () => session, requireCapability: async (_token, capability) => {
    assert.equal(capability, "audit:read"); return session;
  } };
  const feedback = new FeedbackService(database, sessions), audit = new AuditService(database, sessions);
  const diagnosticContext = { schemaVersion: 1, appVersion: "0.1.6", buildVersion: "PRIVATE_DIAGNOSTICS",
    mode: "mobile", screen: "calls", browserFamily: "chromium", connectivity: "online",
    viewport: { width: 390, height: 844, category: "narrow" } };
  const command = { idempotencyKey: randomUUID(), type: "bug", description: "PRIVATE_SUBMISSION_TEXT",
    diagnostics: { status: "available", payload: { ...diagnosticContext,
      structure: { nodes: [{ kind: "main", depth: 1 }], truncated: false } } } };
  await client.query("set local role open_triage_api_runtime");
  const receipt = await feedback.create("unused", command);
  assert.deepEqual(await feedback.create("unused", command), receipt, "retried acceptance must reuse the same submission");
  const query = { category: "feedback", from: new Date(Date.now() - 86400_000).toISOString(),
    to: new Date(Date.now() + 86400_000).toISOString() };
  const accepted = await audit.list("unused", query);
  assert.equal(accepted.entries.length, 1, "a submission must be visible before any review");
  const submitted = accepted.entries[0];
  assert.equal(submitted.source, "feedback.submission");
  assert.equal(submitted.action, "feedback.submit.bug");
  assert.equal(submitted.outcome, "accepted");
  assert.equal(submitted.actorId, senderId);
  assert.equal(submitted.actorDisplayName, "Feedback Sender");
  assert.match(submitted.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(submitted.targetId, submitted.id, "the feedback business key is separate from its public audit UUID");
  assert.deepEqual(submitted.target, { kind: "feedback", label: receipt.referenceCode, version: null });
  await assert.rejects(audit.payload("unused",submitted.source,submitted.id), { status: 403 });
  const metadataSession = session;
  for (const authority of ["installationOwner", "installationSuperadmin"]) {
    session = { ...metadataSession, capabilities: ["audit:read", "audit:identifying"], [authority]: true };
    await assert.rejects(audit.payload("unused",submitted.source,submitted.id), { status: 403 });
  }
  session = { ...metadataSession, capabilities: ["audit:read", "audit:identifying"] };
  const submittedDump = await audit.payload("unused",submitted.source,submitted.id);
  assert.equal(submittedDump.payload.submission.id, submitted.id);
  assert.equal(submittedDump.payload.submission.description, command.description);
  assert.equal(submittedDump.payload.submission.referenceCode, receipt.referenceCode);
  assert.deepEqual(submittedDump.payload.diagnostics.payload, command.diagnostics.payload);
  assert.equal(submittedDump.payload.review, null);
  assert.doesNotMatch(JSON.stringify(submittedDump), /idempotency|password|sessionToken/);

  const auditSession = session;
  session = { ...session, user: { id: reviewerId, displayName: "Feedback Reviewer" } };
  await feedback.create("unused", { ...command, idempotencyKey: randomUUID(), type: "feature",
    diagnostics: { status: "available", payload: diagnosticContext } });
  session = { ...session, user: { id: outsideId, displayName: "Outside Sender" },
    organization: { id: otherOrganizationId, name: "Other feedback agency" } };
  const outsideReceipt = await feedback.create("unused", { ...command, idempotencyKey: randomUUID() });
  session = auditSession;

  await client.query("reset role");
  // A synthetic review decision in this rolled-back fixture must coexist with the original submission.
  await client.query(`select * from feedback.record_review_decision($1,0,'triaged','normal',
    'PRIVATE_APPROVED_SUMMARY','PRIVATE_REVIEW_NOTE','human',$2)`, [receipt.referenceCode,reviewerId]);
  await client.query("set local role open_triage_api_runtime");
  const reviewed = await audit.list("unused", query);
  assert.equal(reviewed.entries.length, 3);
  assert.deepEqual(reviewed.entries.find(row => row.source === "feedback.submission" && row.id === submitted.id), submitted,
    "later review must not rewrite the submission's original event");
  const review = reviewed.entries.find(row => row.action === "feedback.review");
  assert.equal(review.outcome, "triaged");
  assert.equal(review.target.label, receipt.referenceCode);
  assert.equal(review.actorDisplayName, "Feedback Reviewer");
  const reviewedDump = await audit.payload("unused",review.source,review.id);
  assert.equal(reviewedDump.payload.review.id, review.id);
  assert.equal(reviewedDump.payload.review.note, "PRIVATE_REVIEW_NOTE");
  assert.equal(reviewedDump.payload.review.summary, "PRIVATE_APPROVED_SUMMARY");
  assert.equal(reviewedDump.payload.review.reviewerDisplayName, "Feedback Reviewer");
  assert.equal(reviewedDump.payload.submission.description, command.description);
  session = { ...auditSession, organization: { id: otherOrganizationId } };
  await assert.rejects(audit.payload("unused",submitted.source,submitted.id), { status: 404 });
  await assert.rejects(audit.payload("unused",review.source,review.id), { status: 404 });
  session = auditSession;
  assert.ok(reviewed.entries.some(row => row.action === "feedback.submit.feature"));
  const filtered = await audit.list("unused", { ...query, actorId: reviewerId });
  assert.equal(filtered.entries.length, 2);
  assert.ok(filtered.entries.every(row => row.actorId === reviewerId));
  assert.equal((await audit.list("unused", { ...query, from: "2000-01-01T00:00:00.000Z", to: "2000-01-02T00:00:00.000Z" })).entries.length, 0);
  assert.doesNotMatch(JSON.stringify(reviewed), /PRIVATE_|original_description|payload|review_note|Outside Sender/);
  assert.equal(JSON.stringify(reviewed).includes(outsideReceipt.referenceCode), false);
  const inspections = (await client.query(`select inspected_source,inspected_event_id from clinical_audit.audit_read_event
    where organization_id=$1 and inspection_kind='payload' order by id`, [organizationId])).rows;
  assert.deepEqual(inspections, [{ inspected_source: submitted.source, inspected_event_id: submitted.id },
    { inspected_source: review.source, inspected_event_id: review.id }]);
  session = { ...auditSession, capabilities: ["audit:read", "audit:identifying"] };
  const inspectionPage = await audit.list("unused", { ...query, category: "audit" });
  for (const inspected of [submitted, review]) {
    const reference = `${inspected.source}:${inspected.id}`;
    const inspection = inspectionPage.entries.find(row => row.target?.label === reference);
    assert.ok(inspection, `Missing inspection reference ${reference}`);
    assert.equal(inspection.targetId, inspected.id);
    assert.equal(inspection.target.kind, "auditEvent");
    assert.deepEqual(inspection.inspection, { kind: "payload", category: "feedback", categories: null, uuidFilter: null });
  }
  assert.ok(inspectionPage.entries.some(row => row.inspection?.kind === "list" && row.inspection.category === "feedback"));
  session = auditSession;

  await client.query("reset role");
  // Human reviewer attribution also accepts external identities and retained IDs.
  for (const [identity, name] of [["external-reviewer", null], [randomUUID(), null], [reviewerId.toUpperCase(), "Feedback Reviewer"]]) {
    await client.query("savepoint reviewer_label");
    await client.query(`select * from feedback.record_review_decision($1,1,'triaged','normal',
      'PRIVATE_APPROVED_SUMMARY','PRIVATE_REVIEW_NOTE','human',$2)`, [receipt.referenceCode,identity]);
    await client.query("set local role open_triage_api_runtime");
    const latest = (await audit.list("unused", query)).entries.find(row => row.action === "feedback.review");
    const dump = await audit.payload("unused", latest.source, latest.id);
    assert.equal(dump.payload.review.reviewerId, identity);
    assert.equal(dump.payload.review.reviewerDisplayName, name);
    await client.query("rollback to savepoint reviewer_label");
    await client.query("release savepoint reviewer_label");
  }
  // Equal creation timestamps and mixed event sources must paginate without losing or repeating events.
  for (let index = 0; index < 51; index++) await client.query(`insert into feedback.submission
    (reference_code,idempotency_key,submission_type,original_description,organization_id,actor_id,organization_display_name,actor_display_name)
    values($1,$2,'bug','PRIVATE_SUBMISSION_TEXT',$3,$4,'Agency','Sender')`,
  [createFeedbackReference(),randomUUID(),organizationId,senderId]);
  await client.query("set local role open_triage_api_runtime");
  const first = await audit.list("unused", query);
  assert.equal(first.entries.length, 50);
  assert.ok(first.nextCursor);
  const last = await audit.list("unused", { ...query, cursor: first.nextCursor });
  assert.equal(last.entries.length, 4);
  assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.entries,...last.entries].map(row => `${row.source}:${row.id}`)).size, 54);
});

integration("analytics payloads retain complete requests, distinguish older events and enforce identifying scope", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const organizationId = randomUUID(), otherOrganizationId = randomUUID(), actorId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'Analytics dumps','UTC'),($2,'Other analytics dumps','UTC')`, [organizationId,otherOrganizationId]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Auditor')`, [actorId,organizationId]);
  const manager = { query: async (sql,values) => (await client.query(sql,values)).rows };
  const database = { transaction: async (_level,work) => work(manager) };
  let session = { user: { id: actorId }, organization: { id: organizationId }, capabilities: ["audit:read","audit:identifying"] };
  const audit = new AuditService(database, { requireCapability: async () => session });
  const missingOrganizationId = randomUUID();
  const scope = { organizationId,organizationIds: [otherOrganizationId,organizationId,missingOrganizationId],
    userId: actorId,reports: "all",identifying: false,defaultDataset: "synthetic" };
  const request = { definition: { version: 1,metric: "records",aggregation: "count",visualization: "table",
    from: "2026-10-01",through: "2026-10-02",groupBy: null,timeGrouping: "day",
    filters: [{ element: "fixture.field",values: [{ type: "string",value: 'Full search: "åäö" & <text>' }] }] } };
  await client.query("set local role open_triage_api_runtime");
  await recordAnalyticsAccess(database,scope,{ surface: "analytics",operation: "query",dataset: "synthetic",reportIds: [],request });
  // Emulate a retained event predating request capture.
  await recordAnalyticsAccess(database,scope,{ surface: "analytics",operation: "query",dataset: "synthetic",reportIds: [] });
  const query = { category: "analytics",from: new Date(Date.now()-86400_000).toISOString(),to: new Date(Date.now()+86400_000).toISOString() };
  const page = await audit.list("unused",query);
  assert.equal(page.entries.length,2);
  const organizations = [{ id: otherOrganizationId, name: "Other analytics dumps" },
    { id: organizationId, name: "Analytics dumps" }, { id: missingOrganizationId, name: null }];
  assert.deepEqual(page.entries[0].analytics.organizations, organizations);
  assert.equal(page.entries[0].target.label, "analytics.query");
  assert.equal(page.entries[0].target.occurredAt, page.entries[0].occurredAt);
  assert.doesNotMatch(JSON.stringify(page), /Full search|query_payload|fixture.field/);
  const dumps = await Promise.all(page.entries.map(entry => audit.payload("unused",entry.source,entry.id)));
  assert.deepEqual(dumps.find(dump => dump.requestCaptured).payload.request,request);
  for (const dump of dumps) assert.deepEqual(dump.payload.execution.organizations, organizations);
  assert.equal(dumps.find(dump => !dump.requestCaptured).payload.request,null);
  const original = session, entry = page.entries[0];
  session = { ...session,capabilities: ["audit:read"] };
  await assert.rejects(audit.payload("unused",entry.source,entry.id), { status: 403 });
  for (const authority of ["installationOwner","installationSuperadmin"]) {
    session = { ...original,[authority]: true };
    await assert.rejects(audit.payload("unused",entry.source,entry.id), { status: 403 });
  }
  session = { ...original,organization: { id: otherOrganizationId } };
  await assert.rejects(audit.payload("unused",entry.source,entry.id), { status: 404 });
  session = original;
  await audit.list("unused",query); // Restore the transaction's authorized agency scope.
  const inspections = (await client.query(`select inspected_event_id from clinical_audit.audit_read_event
    where organization_id=$1 and inspection_kind='payload'`, [organizationId])).rows;
  assert.deepEqual(new Set(inspections.map(row => row.inspected_event_id)),new Set(page.entries.map(row => row.id)));
});

integration("audit user choices use display names, include disabled members and paginate within the current agency", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const organizationId = randomUUID(), otherOrganizationId = randomUUID();
  const actorId = randomUUID(), outsideId = randomUUID(), sharedId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'Audit directory fixture','UTC'),($2,'Outside audit directory','UTC')`, [organizationId, otherOrganizationId]);
  // Existing installation actors can have retained agency memberships for audit evidence.
  const inheritedIds = (await client.query(`select user_id from app_identity.organization_user
    where organization_id=$1`, [organizationId])).rows.map(row => row.user_id);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name,active)
    values($1,$4,'Alex Disabled',false),($2,$5,'Outside User',true),($3,$5,'Zoe Shared',true)`,
  [actorId, outsideId, sharedId, organizationId, otherOrganizationId]);
  await client.query(`insert into app_identity.organization_user(organization_id,user_id) values($1,$2)`, [organizationId, sharedId]);
  await client.query(`insert into app_identity.app_user(organization_id,display_name)
    select $1,'Repeated Display Name' from generate_series(1,103)`, [organizationId]);
  await client.query("set local role open_triage_api_runtime");
  let currentOrganization = organizationId;
  const capabilities = [];
  const audit = new AuditService({ transaction: async (_level, work) => work({
    query: async (sql, values) => (await client.query(sql, values)).rows,
  }) }, { requireCapability: async (_token, capability) => {
    capabilities.push(capability);
    return { organization: { id: currentOrganization }, user: { id: actorId }, capabilities: ["audit:read"] };
  } });
  const first = await audit.users("unused", {});
  assert.equal(first.users.length, 100);
  assert.ok(first.nextCursor);
  assert.deepEqual(first.users[0], { id: actorId, displayName: "Alex Disabled" });
  const last = await audit.users("unused", { cursor: first.nextCursor });
  assert.equal(last.users.length, 5 + inheritedIds.length);
  assert.equal(last.nextCursor, null);
  assert.deepEqual(last.users.at(-1), { id: sharedId, displayName: "Zoe Shared" });
  const users = [...first.users, ...last.users];
  assert.equal(new Set(users.map(user => user.id)).size, 105 + inheritedIds.length, "equal display names must not skip or repeat users");
  assert.equal(users.some(user => user.id === outsideId), false);
  assert.deepEqual(Object.keys(users[0]).sort(), ["displayName", "id"]);
  currentOrganization = otherOrganizationId;
  assert.deepEqual((await audit.users("unused", {})).users.filter(user => !inheritedIds.includes(user.id))
    .map(user => user.displayName), ["Outside User", "Zoe Shared"]);
  assert.ok(capabilities.every(capability => capability === "audit:read"), "users:read is not required for an audit filter");
});

integration("audit actor names resolve local and SSO usernames without losing retained events or agency scope", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const organizationId = randomUUID(), otherOrganizationId = randomUUID(), providerId = randomUUID();
  const localId = randomUUID(), ssoId = randomUUID(), displayOnlyId = randomUUID(), missingId = randomUUID();
  const username = `audit.${localId}`;
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'Audit actor fixture','UTC'),($2,'Other audit agency','UTC')`, [organizationId, otherOrganizationId]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$4,'Local Clinician'),($2,$4,'SSO Clinician'),($3,$4,'Display-only Clinician')`,
  [localId, ssoId, displayOnlyId, organizationId]);
  await client.query(`insert into app_identity.local_credential(user_id,username,password_verifier,must_change_password)
    values($1,$2,'scrypt$unusable-audit-fixture',false)`, [localId, username]);
  await client.query(`insert into app_identity.oidc_provider_version(group_id,revision,provider_id,configuration,created_by)
    values($1,1,$2,'{"issuer":"https://audit-provider.example"}'::jsonb,$3)`, [organizationId, providerId, localId]);
  for (const [id, hint, daysAgo] of [[localId, "local.sso", 1], [ssoId, "sso.old", 2], [ssoId, "sso.current", 1]]) {
    await client.query(`insert into app_identity.regional_identity_request
      (group_id,provider_id,first_revision,organization_id,issuer,subject,username_hint,linked_user_id,linked_by,linked_at)
      values($1,$2,1,$1,'https://audit-provider.example',$3,$3,$4,$5,now()-$6*interval '1 day')`,
    [organizationId, providerId, hint, id, localId, daysAgo]);
  }
  // Disabled accounts remain identifiable in historical audit results.
  await client.query("update app_identity.app_user set active=false where id=$1", [localId]);
  for (const [agency, id] of [[organizationId, localId], [organizationId, ssoId],
    [organizationId, displayOnlyId], [organizationId, missingId], [otherOrganizationId, localId]]) {
    await client.query(`insert into clinical_audit.patient_access_event
      (organization_id,access_organization_id,actor_id,patient_id,report_id,action,care_process,synthetic)
      values($1,$1,$2,$3,$4,'report.read','documentation',true)`, [agency, id, randomUUID(), randomUUID()]);
  }
  await client.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result)
    values($1,null,'authentication.sign_in','failed')`, [organizationId]);
  await client.query("set local role open_triage_api_runtime");
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const audit = new AuditService({ transaction: async (_level, work) => work(manager) }, {
    requireCapability: async () => ({ organization: { id: organizationId }, user: { id: localId },
      capabilities: ["audit:read", "audit:identifying"] }),
  });
  const query = { category: "patient", from: new Date(Date.now() - 86400_000).toISOString(),
    to: new Date(Date.now() + 86400_000).toISOString() };
  const page = await audit.list("unused", query);
  assert.equal(page.entries.length, 4, "actor lookup must not add events from another agency");
  const actors = new Map(page.entries.map(entry => [entry.actorId, [entry.actorUsername, entry.actorDisplayName]]));
  assert.deepEqual(actors.get(localId), [username, "Local Clinician"], "local username takes precedence over linked SSO");
  assert.deepEqual(actors.get(ssoId), ["sso.current", "SSO Clinician"], "latest linked SSO username is used");
  assert.deepEqual(actors.get(displayOnlyId), [null, "Display-only Clinician"]);
  assert.deepEqual(actors.get(missingId), [null, null], "missing accounts must not remove historical events");
  assert.doesNotMatch(JSON.stringify(page), /password_verifier|unusable-audit-fixture|audit-provider/);
  const filtered = await audit.list("unused", { ...query, actorId: ssoId });
  assert.equal(filtered.entries.length, 1);
  assert.equal(filtered.entries[0].actorUsername, "sso.current");
  const anonymous = await audit.list("unused", { ...query, category: "authentication" });
  assert.equal(anonymous.entries.length, 1);
  assert.equal(anonymous.entries[0].actorId, null);
  assert.equal(anonymous.entries[0].actorUsername, null);
  assert.equal(anonymous.entries[0].actorDisplayName, null);
});

integration("patient-access evidence and every admin log section enforce the runtime database boundary", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const template = (await client.query(`select b.*, d.id as agency_demographic_version_id,
    u.id as documenting_user_id from app_identity.active_configuration_bundle b
    join app_identity.agency_demographic_version d on d.organization_id=b.organization_id
      and d.catalog_release_id=b.catalog_release_id
    join app_identity.agency_user u on u.organization_id=b.organization_id and u.active
    limit 1`)).rows[0];
  assert.ok(template, "The preceding API integration suite must seed an active configuration");
  const organizationId = template.organization_id, actorId = template.documenting_user_id;
  const reportId = randomUUID(), patientId = randomUUID(), incidentId = randomUUID();
  await client.query("insert into clinical.incident(id,organization_id,synthetic) values($1,$2,true)", [incidentId, organizationId]);
  await client.query(`insert into clinical.patient(id,organization_id,identity_state,pseudonymous_key)
    values($1,$2,'unknown',$3)`, [patientId, organizationId, reportId.replaceAll("-", "").repeat(2)]);
  await client.query(`insert into clinical.report(id,organization_id,incident_id,patient_id,
    agency_demographic_version_id,form_version_id,catalog_release_id,documenting_user_id,
    validation_version_id,synthetic,form_definition_sha256,catalog_artifact_sha256,validation_compiled_sha256)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12)`, [reportId, organizationId, incidentId,
    patientId, template.agency_demographic_version_id, template.form_version_id, template.catalog_release_id,
    actorId, template.validation_version_id, template.form_definition_sha256, template.catalog_artifact_sha256,
    template.validation_compiled_sha256]);
  await client.query(`insert into clinical.element_occurrence(id,report_id,catalog_release_id,
    element_identity_id,element_id,analytical_repeatable,identifying,value_kind,value_text,provenance_kind,author_id)
    select $1,$2,release_id,element_identity_id,element_id,analytical_location='repeatable',identifying,
      'text','PCR-000012345','dispatch',$3
    from catalog.analytics_element_mapping where release_id=$4 and element_id='eRecord.01'`,
  [randomUUID(), reportId, actorId, template.catalog_release_id]);
  const otherOrganizationId = randomUUID();
  await client.query(`insert into clinical_audit.patient_access_event
    (organization_id, access_organization_id, actor_id, patient_id, report_id, action, care_process, synthetic)
    values($1,$1,$2,$3,$4,'report.read','documentation',true)`, [otherOrganizationId, actorId, patientId, reportId]);

  let serial = 0;
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const database = { ...manager, manager, transaction: async (first, second) => {
    const savepoint = `audit_test_${++serial}`;
    await client.query(`savepoint ${savepoint}`);
    try {
      const result = await (typeof first === "function" ? first : second)(manager);
      await client.query(`release savepoint ${savepoint}`);
      return result;
    } catch (error) {
      await client.query(`rollback to savepoint ${savepoint}`);
      await client.query(`release savepoint ${savepoint}`);
      throw error;
    }
  } };
  let session = { user: { id: actorId }, organization: { id: organizationId }, capabilities: ["audit:read", "audit:identifying", "clinical:document"] };
  const sessions = { requireCapability: async (_token, capability) => {
    if (!session.capabilities.includes(capability)) throw Object.assign(new Error("denied"), { status: 403 });
    return session;
  } };
  const audit = new AuditService(database, sessions);
  const reports = new DraftReportService(database, sessions);
  const photoId = randomUUID(), capturedAt = "2026-10-17T10:00:00.000Z";
  await client.query(`insert into clinical.report_photo_note
    (id,organization_id,report_id,captured_at,captured_utc_offset_minutes,caption,
      content_type,byte_size,sha256,width,height,created_by,updated_by)
    values($1,$2,$3,$4,0,'PRIVATE_PHOTO_CAPTION','image/jpeg',12,$5,1,1,$6,$6)`,
  [photoId,organizationId,reportId,capturedAt,"a".repeat(64),actorId]);
  await client.query("set local role open_triage_api_runtime");
  const photoReference = { target_kind: "photo", target_id: photoId };
  const photoLabels = await resolveAuditTargets(manager, organizationId, [photoReference]);
  assert.deepEqual(photoLabels.get(`photo:${photoId}`), { kind: "photo", label: null, version: null, occurredAt: capturedAt });
  assert.equal((await resolveAuditTargets(manager, otherOrganizationId, [photoReference])).size, 0);
  assert.doesNotMatch(JSON.stringify([...photoLabels.values()]), /PRIVATE_PHOTO_CAPTION/);
  assert.equal((await client.query("select * from clinical_audit.patient_access_event")).rowCount, 0,
    "API connections cannot read audit rows without an explicit transaction scope");

  await reports.get("never-log-this-token", reportId);
  const base = { category: "patient", from: new Date(Date.now() - 86400_000).toISOString(),
    to: new Date(Date.now() + 86400_000).toISOString(), targetId: patientId };
  const first = await audit.list("never-log-this-token", base);
  assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0].actorId, actorId);
  assert.equal(first.entries[0].targetId, reportId);
  assert.deepEqual(first.entries[0].target, { kind: "report", label: "PCR-000012345", version: null });
  assert.equal(first.entries[0].patientId, patientId);
  assert.equal(first.entries[0].action, "report.read");
  assert.equal(first.entries[0].accessOrganizationId, organizationId);
  assert.equal(first.entries[0].accessOrganizationName,
    (await client.query("select name from app_identity.organization where id=$1", [organizationId])).rows[0].name);
  assert.doesNotMatch(JSON.stringify(first), /never-log-this-token|canonical_bytes|prior_value|recovery_handle/);

  for (const category of auditCategories) {
    const page = await audit.list("unused", { category, from: base.from, to: base.to });
    assert.ok(Array.isArray(page.entries), `${category} is queryable with runtime grants`);
  }
  // Tie timestamps deliberately: pagination must preserve all 55 distinct events.
  await client.query("reset role");
  await client.query(`insert into clinical_audit.patient_access_event
    (organization_id,access_organization_id,actor_id,patient_id,report_id,action,care_process,synthetic,occurred_at)
    select $1,$1,$2,$3,$4,'report.active','documentation',true,date_trunc('second',clock_timestamp())
    from generate_series(1,55)`, [organizationId,actorId,patientId,reportId]);
  await client.query("set local role open_triage_api_runtime");
  const page1 = await audit.list("unused", base);
  assert.equal(page1.entries.length, 50);
  assert.ok(page1.nextCursor);
  const page2 = await audit.list("unused", { ...base, cursor: page1.nextCursor });
  assert.equal(page2.entries.length, 6);
  assert.equal(new Set([...page1.entries, ...page2.entries].map((row) => row.id)).size, 56);

  session = { ...session, organization: { id: otherOrganizationId } };
  const outside = await audit.list("unused", base);
  assert.equal(outside.entries.length, 1);
  assert.deepEqual(outside.entries[0].target, { kind: "report", label: null }, "retained IDs must not reveal another agency's PCR number");
  session = { ...session, organization: { id: organizationId } };
  await assert.rejects(database.transaction(async () => {
    await recordPatientAccess(manager, { organizationId: otherOrganizationId, actorId,
      reportIds: [reportId], action: "report.read", careProcess: "documentation" });
  }), { status: 503 });

  for (const sql of ["delete from clinical_audit.patient_access_event", "update clinical_audit.patient_access_event set action='report.read'",
    "truncate clinical_audit.patient_access_event", "delete from clinical_audit.audit_read_event",
    "select recovery_handle from offline_recovery.event"]) {
    await assert.rejects(database.transaction(async () => manager.query(sql)), { code: "42501" });
  }
  // The API cannot forge server timestamps, even with a syntactically valid insert.
  await assert.rejects(database.transaction(async () => manager.query(`insert into clinical_audit.patient_access_event
    (occurred_at,organization_id,access_organization_id,actor_id,patient_id,report_id,action,care_process,synthetic)
    values(now(),$1,$1,$2,$3,$4,'report.read','documentation',true)`, [organizationId,actorId,patientId,reportId])), { code: "42501" });
  await client.query("reset role");
  assert.equal((await client.query(`select count(*)::int n from clinical_audit.audit_read_event
    where organization_id=$1 and actor_id=$2`, [organizationId, actorId])).rows[0].n, auditCategories.length + 3);
  await client.query("savepoint clinical_value_fixture");
  const changeId = randomUUID();
  await client.query(`insert into clinical.report_change(id,report_id,revision,idempotency_key,author_id,changes)
    values($1,$2,1,$3,$4,$5::jsonb)`, [changeId, reportId, randomUUID(), actorId,
    JSON.stringify({ baseRevision: 0, occurrences: [{ value: "Fictional clinical detail" }] })]);
  await client.query("set local role open_triage_api_runtime");
  const clinicalPage = await audit.list("unused", { ...base, category: "clinical", targetId: reportId });
  assert.ok(clinicalPage.entries.some(row => row.source === "clinical.report_change"));
  assert.doesNotMatch(JSON.stringify(clinicalPage), /Fictional clinical detail|occurrences/);
  const values = await audit.clinicalValues("unused", "clinical.report_change", changeId);
  assert.deepEqual(values.values, { submittedChanges: { occurrences: [{ value: "Fictional clinical detail" }] } });
  const inspectionPage = await audit.list("unused", { ...base, category: "audit", targetId: changeId });
  assert.equal(inspectionPage.entries.length, 1);
  assert.equal(inspectionPage.entries[0].targetId, changeId);
  assert.deepEqual(inspectionPage.entries[0].target, { kind: "auditEvent", label: `clinical.report_change:${changeId}` });
  assert.deepEqual(inspectionPage.entries[0].inspection, { kind: "clinical-values", category: "clinical", categories: null, uuidFilter: null });
  const legacyInspection = (await client.query(`insert into clinical_audit.audit_read_event
    (organization_id,actor_id,category,from_time,to_time,target_filter,returned_count,inspection_kind)
    values($1,$2,'clinical',now(),now()+interval '1 second',$3,1,'clinical-values') returning audit_id as id`,
  [organizationId, actorId, reportId])).rows[0];
  const legacyPage = await audit.list("unused", { ...base, category: "audit", targetId: reportId });
  const legacy = legacyPage.entries.find(row => row.id === String(legacyInspection.id));
  assert.equal(legacy.targetId, reportId);
  assert.equal(legacy.target.kind, "report", "older inspections must not invent an event ID from their report ID");
  for (const [kind, sourceName] of [["list", "clinical.report_change"], ["clinical-values", "feedback.submission"], ["payload", null]]) {
    await client.query("savepoint invalid_inspection_reference");
    await assert.rejects(client.query(`insert into clinical_audit.audit_read_event
      (organization_id,actor_id,category,from_time,to_time,returned_count,inspection_kind,inspected_source,inspected_event_id)
      values($1,$2,'clinical',now(),now()+interval '1 second',1,$3,$4,$5)`,
    [organizationId, actorId, kind, sourceName, changeId]), { code: "23514" });
    await client.query("rollback to savepoint invalid_inspection_reference");
    await client.query("release savepoint invalid_inspection_reference");
  }
  const authorizedSession = session;
  for (const capabilities of [["audit:read"], ["audit:read", "review:identifying"]]) {
    session = { ...authorizedSession, capabilities };
    await assert.rejects(audit.clinicalValues("unused", "clinical.report_change", changeId), { status: 403 });
    const metadata = await audit.list("unused", { ...base, targetId: reportId, category: "clinical" });
    assert.ok(metadata.entries.some(row => row.id === changeId));
    assert.ok(metadata.entries.every(row => row.target?.label === "PCR-000012345"));
    const access = await audit.list("unused", base);
    assert.ok(access.entries.length);
    assert.ok(access.entries.every(row => row.patientId === patientId && row.target?.label === "PCR-000012345"));
    assert.doesNotMatch(JSON.stringify(access), /Fictional clinical detail/);
    await audit.list("unused", { ...base, category: "authentication" });
  }
  for (const authority of ["installationOwner", "installationSuperadmin"]) {
    session = { ...authorizedSession, [authority]: true };
    await assert.rejects(audit.clinicalValues("unused", "clinical.report_change", changeId), { status: 403 });
    const access = await audit.list("unused", base);
    assert.ok(access.entries.length);
    assert.ok(access.entries.every(row => row.patientId === patientId && row.target?.label === "PCR-000012345"));
  }
  session = { ...authorizedSession, organization: { id: otherOrganizationId } };
  await assert.rejects(audit.clinicalValues("unused", "clinical.report_change", changeId), { status: 404 });
  session = authorizedSession;
  await client.query("reset role");
  assert.equal((await client.query(`select count(*)::int n from clinical_audit.audit_read_event
    where organization_id=$1 and inspection_kind='clinical-values' and target_filter=$2`, [organizationId,reportId])).rows[0].n, 2);
  await client.query("rollback to savepoint clinical_value_fixture");
  await client.query("set local role open_triage_api_runtime");

  const scope = { organizationId, userId: actorId, reports: "all", identifying: false, defaultDataset: "synthetic" };
  for (const operation of ["query", "counts", "export.aggregate", "export.records"]) {
    await recordAnalyticsAccess(database, scope, { surface: "analytics", operation, dataset: "synthetic",
      from: "2026-10-01", through: "2026-10-02", reportIds: [reportId] });
  }
  await recordAnalyticsAccess(database, scope, { surface: "analytics", operation: "query", dataset: "synthetic", reportIds: [] });
  const analyticsPage = await audit.list("unused", { ...base, category: "analytics", targetId: undefined });
  assert.equal(analyticsPage.entries.length, 5);
  assert.equal(analyticsPage.entries.filter(row => row.analytics.reportCount === 1).length, 4);
  assert.ok(analyticsPage.entries.some(row => row.action === "analytics.export.records"));
  const linked = await audit.list("unused", { ...base, targetId: analyticsPage.entries.find(row => row.action === "analytics.export.records").id });
  assert.equal(linked.entries.length, 1);
  assert.equal(linked.entries[0].patientId, patientId);
  assert.equal(linked.entries[0].action, "analytics.export.records");
  assert.equal(linked.entries[0].resource.label, "analytics.export.records");
  assert.equal(linked.entries[0].resource.occurredAt,
    analyticsPage.entries.find(row => row.action === "analytics.export.records").occurredAt);
  await assert.rejects(recordAnalyticsAccess(database, { ...scope, organizationId: otherOrganizationId },
    { surface: "analytics", operation: "query", dataset: "synthetic", reportIds: [reportId] }), { status: 503 });
  for (const sql of ["delete from clinical_audit.analytics_access_event", "truncate clinical_audit.analytics_access_event",
    "update clinical_audit.analytics_access_event set operation='query'"]) {
    await assert.rejects(database.transaction(async () => manager.query(sql)), { code: "42501" });
  }
  await client.query("reset role");
  assert.equal((await client.query(`select count(*)::int n from app_identity.capability_prerequisite
    where capability_key='audit:identifying' and prerequisite_key='audit:read'`)).rows[0].n, 1);
  // Audit rows have no cascading relationship to clinical retention.
  await client.query("delete from clinical.report where id=$1", [reportId]);
  await client.query("delete from clinical.patient where id=$1", [patientId]);
  await client.query("set local role open_triage_api_runtime");
  const retained = await audit.list("unused", base);
  assert.equal(retained.entries.length, 50);
  assert.deepEqual(retained.entries[0].target, { kind: "report", label: null });
  await client.query("reset role");
  assert.equal((await client.query("select count(*)::int n from clinical_audit.patient_access_event where patient_id=$1", [patientId])).rows[0].n, 61);
  assert.equal((await client.query("select count(*)::int n from clinical_audit.analytics_access_event where organization_id=$1 and id=any($2::uuid[])", [organizationId,analyticsPage.entries.map(row => row.id)])).rows[0].n, 5);
  await assert.rejects(database.transaction(async () => manager.query("truncate clinical_audit.patient_access_event")), { code: "42501" });
});

integration("audit target names are typed, agency-scoped metadata using runtime grants", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const config = (await client.query(`select b.*,o.name organization_name,f.name form_name,fv.version form_version,
      v.display_name validation_name,v.version validation_version,v.rule_id,
      d.id demographics_id,d.version demographics_version
    from app_identity.active_configuration_bundle b
    join app_identity.organization o on o.id=b.organization_id
    join forms.form_version fv on fv.id=b.form_version_id join forms.form f on f.id=fv.form_id
    join validation.version v on v.id=b.validation_version_id
    join app_identity.agency_demographic_version d on d.organization_id=b.organization_id
      and d.catalog_release_id=b.catalog_release_id limit 1`)).rows[0];
  const organizationId = config.organization_id;
  const role = (await client.query(`select id,display_name,current_version_id from app_identity.role
    where organization_id=$1 limit 1`, [organizationId])).rows[0];
  const unit = (await client.query(`insert into app_identity.operational_unit
    (id,organization_id,call_sign,name,default_form_id,synthetic)
    select $1,$2,'AUDIT-LABEL','Audit label unit',form_id,true from forms.form_version where id=$3
    returning id,call_sign,name`, [randomUUID(),organizationId,config.form_version_id])).rows[0];
  const user = (await client.query(`select id,display_name from app_identity.agency_user
    where organization_id=$1 limit 1`, [organizationId])).rows[0];
  const criterionId = randomUUID(), criterionAuthor = randomUUID();
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,app_identity.organization_group($2),'Audit criterion author')`, [criterionAuthor,organizationId]);
  await client.query(`insert into validation.rule_identity(id,organization_id,created_by) values($1,$2,$3)`,
    [criterionId,organizationId,user.id]);
  await client.query(`insert into validation.version(id,organization_id,catalog_release_id,rule_id,display_name,source_rule,created_by)
    select $1,organization_id,catalog_release_id,$2,'Audit routing criterion',source_rule,$3
    from validation.version where id=$4`, [randomUUID(),criterionId,criterionAuthor,config.validation_version_id]);
  const otherOrganizationId = randomUUID(), outsideUserId = randomUUID(), missingId = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone) values($1,'Outside agency','UTC')`, [otherOrganizationId]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Outside user')`, [outsideUserId, otherOrganizationId]);
  const feedbackId = (await client.query(`insert into feedback.submission(reference_code,submission_type,
    original_description,organization_id,actor_id,organization_display_name,actor_display_name,idempotency_key)
    values('AUDITLABELAA','bug','Never expose this description',$1,$2,'Agency','Actor',$3) returning id`,
  [organizationId,user.id,randomUUID()])).rows[0].id;
  const targets = [
    ["user",user.id,user.display_name], ["role",role.id,role.display_name],
    ["roleVersion",role.current_version_id,role.display_name], ["organization",organizationId,config.organization_name],
    ["form",config.form_version_id,config.form_name], ["validation",config.validation_version_id,config.validation_name],
    ["demographics",config.demographics_id,config.organization_name], ["unit",unit.id,`${unit.call_sign} · ${unit.name}`],
    ["criterion",criterionId,"Audit routing criterion"], ["feedback",feedbackId,"AUDITLABELAA"],
  ];
  await client.query("set local role open_triage_api_runtime");
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const result = await resolveAuditTargets(manager, organizationId, [
    ...targets.map(([kind,id]) => ({ target_kind: kind, target_id: id })),
    ...["ownershipTransfer","report","reviewItem","analysis","call","installation","analytics","photo","audio","note"].map(kind => ({ target_kind: kind, target_id: missingId })),
    { target_kind: "user", target_id: outsideUserId }, { target_kind: "organization", target_id: otherOrganizationId },
    { target_kind: "user", target_id: config.form_version_id }, // Wrong type must not search other tables.
  ]);
  assert.equal(result.size, targets.length);
  for (const [kind,id,label] of targets) assert.equal(result.get(`${kind}:${id}`).label, label, kind);
  assert.equal(result.get(`form:${config.form_version_id}`).version, config.form_version);
  assert.equal(result.get(`validation:${config.validation_version_id}`).version, config.validation_version);
  assert.equal(result.get(`demographics:${config.demographics_id}`).version, config.demographics_version);
  assert.doesNotMatch(JSON.stringify([...result.values()]), /Outside|Never expose/);
  // A shared catalog must also work as the sole target type (no agency-owned lookup).
  const catalog = await resolveAuditTargets(manager, organizationId, [{ target_kind: "catalog", target_id: config.catalog_release_id }]);
  assert.ok(catalog.get(`catalog:${config.catalog_release_id}`).label.includes("NEMSIS"));
});

integration("combined audit pages merge types in one stable timeline, apply shared filters and record the selected scope", async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const agency = randomUUID(), otherAgency = randomUUID(), actor = randomUUID(), otherActor = randomUUID(), target = actor;
  for (const id of [agency, otherAgency]) await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'Combined audit fixture','UTC')`, [id]);
  for (const id of [actor, otherActor]) await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$2,'Combined Auditor')`, [id, agency]);
  const fixtureTime = new Date(Date.now() - 60_000).toISOString();
  // Both categories have ties, and their times interleave across the page boundary.
  await client.query(`insert into app_identity.authentication_event
    (organization_id,actor_id,target_user_id,action,result,occurred_at)
    select $1,$2,$3,'authentication.sign_in','succeeded',
      $4::timestamptz + (n % 10) * interval '1 microsecond'
    from generate_series(1,31) n`, [agency, actor, target, fixtureTime]);
  await client.query(`insert into app_identity.authorization_event
    (organization_id,actor_id,target_type,target_key,action,details,occurred_at)
    select $1,$2,'role',$3,'role.package_preview','{}',
      $4::timestamptz + (n % 10) * interval '1 microsecond'
    from generate_series(1,31) n`, [agency, actor, target, fixtureTime]);
  for (const [org,user,resource] of [[otherAgency,actor,target],[agency,otherActor,target],[agency,actor,otherActor]]) {
    await client.query(`insert into app_identity.authentication_event
      (organization_id,actor_id,target_user_id,action,result,occurred_at)
      values($1,$2,$3,'authentication.sign_in','failed',$4)`, [org,user,resource,fixtureTime]);
  }
  const expected = (await client.query(`select * from (
    select audit_id::text id,occurred_at,'app_identity.authentication_event' source from app_identity.authentication_event
      where organization_id=$1 and actor_id=$2 and target_user_id=$3
    union all
    select audit_id::text id,occurred_at,'app_identity.authorization_event' source from app_identity.authorization_event
      where organization_id=$1 and actor_id=$2 and target_key=$3::text
    ) events order by occurred_at desc,source desc,id desc`, [agency,actor,target])).rows;
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  let session = { user: { id: actor }, organization: { id: agency }, capabilities: ["audit:read", "audit:identifying"] };
  const audit = new AuditService({ transaction: async (_level, work) => work(manager) }, { requireCapability: async () => session });
  await client.query("set local role open_triage_api_runtime");
  const range = { from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 86400_000).toISOString() };
  const query = { ...range, categories: "authorization,authentication", actorId: actor, targetId: target };
  const first = await audit.list("fixture", query);
  assert.equal(first.entries.length, 50); assert.ok(first.nextCursor);
  assert.deepEqual(new Set(first.entries.map(row => row.category)), new Set(["authentication", "authorization"]));
  const next = await audit.list("fixture", { ...query, cursor: first.nextCursor });
  assert.equal(next.entries.length, 12); assert.equal(next.nextCursor, null);
  assert.deepEqual([first.pageNumber,first.totalPages,first.totalEntries],[1,2,62]);
  assert.deepEqual([next.pageNumber,next.totalPages,next.totalEntries],[2,2,62]);
  assert.deepEqual([...first.entries, ...next.entries].map(row => row.id), expected.map(row => row.id));
  const inspections = (await client.query(`select category,queried_categories,returned_count,actor_filter,target_filter
    from clinical_audit.audit_read_event where organization_id=$1 order by id`, [agency])).rows;
  assert.deepEqual(inspections, [50,12].map(count => ({ category: "combined", queried_categories: ["authentication","authorization"],
    returned_count: count, actor_filter: actor, target_filter: target })));
  const inspectionPage = await audit.list("fixture", { ...range, categories: "audit", targetId: target });
  assert.equal(inspectionPage.entries.length, 2);
  assert.ok(inspectionPage.entries.every(row => row.category === "audit" && row.inspection.category === "combined"));
  assert.deepEqual(inspectionPage.entries[0].inspection.categories, ["authentication", "authorization"]);
  // Category selection never requires identifying access; sensitive fields do.
  const all = await audit.list("fixture", { ...range, categories: "" });
  assert.deepEqual(all.categories, auditCategories);
  session = { ...session, capabilities: ["audit:read"] };
  const limited = await audit.list("fixture", range);
  assert.deepEqual(limited.categories, auditCategories);
  assert.ok(limited.entries.every(row => limited.categories.includes(row.category)));
  const lastInspection = (await client.query(`select queried_categories from clinical_audit.audit_read_event
    where organization_id=$1 order by id desc limit 1`, [agency])).rows[0];
  assert.deepEqual(lastInspection.queried_categories, limited.categories);
  assert.ok((await audit.list("fixture", { ...range, categories: "authentication,patient" })).entries.length);
  const empty = await audit.list("fixture", { ...range, categories: "feedback,installations" });
  assert.deepEqual(empty.entries, []); assert.equal(empty.nextCursor, null);
  // The runtime can append scope evidence, but cannot rewrite it afterward.
  await client.query("savepoint immutable_scope");
  await assert.rejects(client.query("update clinical_audit.audit_read_event set queried_categories=array['feedback']"));
  await client.query("rollback to savepoint immutable_scope");
  for (const [category, types] of [["combined",null],["combined",[]],["combined",["authentication"]],
    ["combined",["authentication","unknown"]],["combined",["authentication",null]],["feedback",["authentication"]]]) {
    await client.query("savepoint invalid_scope");
    await assert.rejects(client.query(`insert into clinical_audit.audit_read_event
      (organization_id,actor_id,category,queried_categories,from_time,to_time,returned_count)
      values($1,$2,$3,$4,$5,$6,0)`, [agency,actor,category,types,range.from,range.to]), /check constraint/);
    await client.query("rollback to savepoint invalid_scope");
  }
});

integration("any-UUID search matches audit metadata across sources without crossing agency or capability boundaries", async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const agency = randomUUID(), outsideAgency = randomUUID(), accessAgency = randomUUID(), scopedAgency = randomUUID();
  const actor = randomUUID(), patient = randomUUID(), report = randomUUID(), resource = randomUUID(), queryLiteral = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone)
    values($1,'UUID search fixture','UTC'),($2,'Outside UUID search fixture','UTC')`, [agency,outsideAgency]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name)
    values($1,$2,'UUID Auditor')`, [actor,agency]);
  const addAccess = async organization => (await client.query(`insert into clinical_audit.patient_access_event
    (organization_id,access_organization_id,actor_id,patient_id,report_id,resource_id,action,care_process,synthetic)
    values($1,$2,$3,$4,$5,$6,'photo.read','documentation',true) returning audit_id`,
  [organization,accessAgency,actor,patient,report,resource])).rows[0].audit_id;
  const event = await addAccess(agency), outsideEvent = await addAccess(outsideAgency);
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const database = { transaction: async (_level, work) => work(manager) };
  let session = { user: { id: actor }, organization: { id: agency }, capabilities: ["audit:read", "audit:identifying"] };
  const audit = new AuditService(database, { requireCapability: async () => session });
  await client.query("set local role open_triage_api_runtime");
  const range = { from: new Date(Date.now() - 86400_000).toISOString(), to: new Date(Date.now() + 86400_000).toISOString() };
  for (const id of [event,actor,patient,report,resource,accessAgency,agency]) {
    const page = await audit.list("fixture", { ...range, categories: "patient", uuid: id.toUpperCase() });
    assert.deepEqual(page.entries.map(row => row.id), [event], `UUID ${id} matches only the authorized event`);
    assert.equal(page.nextCursor,null);
    assert.deepEqual([page.pageNumber,page.totalPages,page.totalEntries],[1,1,1]);
    const inspection = (await client.query(`select uuid_filter,target_filter from clinical_audit.audit_read_event
      where organization_id=$1 order by id desc limit 1`, [agency])).rows[0];
    assert.deepEqual(inspection,{ uuid_filter:id,target_filter:null });
  }
  for (const id of [outsideEvent,outsideAgency,randomUUID()]) {
    assert.deepEqual((await audit.list("fixture",{ ...range,categories:"patient",uuid:id })).entries,[]);
  }
  // The user dropdown remains an additional constraint, not an alternative UUID match.
  assert.deepEqual((await audit.list("fixture",{ ...range,categories:"patient",uuid:event,actorId:randomUUID() })).entries,[]);
  await assert.rejects(audit.list("fixture",{ ...range,uuid:event.slice(0,8) }),{ status:400 });
  await recordAnalyticsAccess(database,{
    organizationId:agency,organizationIds:[agency,scopedAgency],userId:actor,reports:"all",identifying:false,defaultDataset:"synthetic",
  },{ surface:"analytics",operation:"query",dataset:"synthetic",reportIds:[],request:{ search:queryLiteral } });
  const analytics = await audit.list("fixture",{ ...range,categories:"analytics",uuid:scopedAgency });
  assert.equal(analytics.entries.length,1);
  assert.deepEqual(analytics.entries[0].analytics.organizationIds,[agency,scopedAgency]);
  assert.deepEqual((await audit.list("fixture",{ ...range,categories:"analytics",uuid:queryLiteral })).entries,[],
    "query literals and protected payload content are not treated as metadata UUIDs");
  const scopedInspection = await audit.list("fixture",{ ...range,categories:"audit",uuid:scopedAgency });
  assert.equal(scopedInspection.entries.length,1);
  assert.equal(scopedInspection.entries[0].inspection.uuidFilter,scopedAgency);
  const historicActorFilter = randomUUID();
  await client.query(`insert into clinical_audit.audit_read_event
    (organization_id,actor_id,category,from_time,to_time,actor_filter,returned_count)
    values($1,$2,'authentication',$3,$4,$5,0)`,[agency,actor,range.from,range.to,historicActorFilter]);
  assert.equal((await audit.list("fixture",{ ...range,categories:"audit",uuid:historicActorFilter })).entries.length,1);
  // Repeated UUID values across metadata fields must not duplicate a row, including across pages.
  await client.query("reset role");
  for (let index=0;index<55;index++) await addAccess(agency);
  await client.query("set local role open_triage_api_runtime");
  const query = { ...range,categories:"patient,analytics",uuid:actor };
  const first = await audit.list("fixture",query);
  const next = await audit.list("fixture",{ ...query,cursor:first.nextCursor });
  assert.equal(first.entries.length,50); assert.equal(next.entries.length,7); assert.equal(next.nextCursor,null);
  assert.equal(new Set([...first.entries,...next.entries].map(row=>row.id)).size,57);
  const original=session;
  session={ ...session,capabilities:["audit:read"] };
  for (const categories of [undefined, "patient"]) {
    const metadata = await audit.list("fixture", { ...range, categories, uuid:event });
    assert.deepEqual(metadata.entries.filter(row => row.category === "patient").map(row => row.id), [event]);
    assert.equal(metadata.entries.find(row => row.id === event).patientId, patient);
  }
  session={ ...original,organization:{ id:outsideAgency } };
  assert.deepEqual((await audit.list("fixture",{ ...range,categories:"patient",uuid:event })).entries,[]);
  assert.deepEqual((await audit.list("fixture",{ ...range,categories:"patient",uuid:patient })).entries.map(row=>row.id),[outsideEvent]);
});

integration("audit pagination counts empty and exact page boundaries and excludes newer events during traversal", async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const agency=randomUUID(), actor=randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone) values($1,'Page count fixture','UTC')`,[agency]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Page Auditor')`,[actor,agency]);
  const manager={ query:async(sql,values)=>(await client.query(sql,values)).rows };
  const audit=new AuditService({ transaction:async(_level,work)=>work(manager) },{ requireCapability:async()=>({
    user:{ id:actor },organization:{ id:agency },capabilities:["audit:read","audit:identifying"],
  }) });
  const range={ from:new Date(Date.now()-86400_000).toISOString(),to:new Date(Date.now()+86400_000).toISOString() };
  let previous=0;
  for (const count of [0,1,50,51,100,101]) {
    await client.query("reset role");
    await client.query(`insert into app_identity.authentication_event(organization_id,actor_id,action,result)
      select $1,$2,'authentication.sign_in','succeeded' from generate_series(1,$3::integer)`,[agency,actor,count-previous]);
    previous=count;
    await client.query("set local role open_triage_api_runtime");
    let cursor, number=0, seen=0;
    do {
      const page=await audit.list("fixture",{ ...range,categories:"authentication",cursor });
      number++;
      assert.equal(page.totalEntries,count);
      assert.equal(page.totalPages,Math.ceil(count/50));
      assert.equal(page.pageNumber,count ? number : 0);
      seen+=page.entries.length;
      cursor=page.nextCursor;
    } while (cursor);
    assert.equal(seen,count);
  }
  // Browsing itself appends audit entries. A traversal keeps its original cutoff,
  // while returning to page one includes the newly recorded inspections.
  const query={ ...range,categories:"audit" };
  const initial=await audit.list("fixture",query);
  await client.query("reset role");
  await client.query(`insert into clinical_audit.audit_read_event
    (organization_id,actor_id,category,from_time,to_time,returned_count)
    select $1,$2,'authentication',$3,$4,0 from generate_series(1,60)`,[agency,actor,range.from,range.to]);
  await client.query("set local role open_triage_api_runtime");
  const first=await audit.list("fixture",query);
  assert.equal(first.totalEntries,initial.totalEntries+61);
  assert.ok(first.nextCursor);
  const next=await audit.list("fixture",{ ...query,cursor:first.nextCursor });
  assert.equal(next.totalEntries,first.totalEntries);
  assert.equal(next.totalPages,first.totalPages);
  assert.equal(next.pageNumber,2);
  assert.equal(next.entries.length,first.totalEntries-50);
  const refreshed=await audit.list("fixture",query);
  assert.equal(refreshed.totalEntries,first.totalEntries+2);
  assert.equal(refreshed.pageNumber,1);
  const empty=await audit.list("fixture",{ ...range,categories:"authentication",uuid:randomUUID() });
  assert.deepEqual([empty.pageNumber,empty.totalPages,empty.totalEntries],[0,0,0]);
});

integration("audit catalog includes integration and omitted ledgers, scopes group configuration, and preserves identifying access", async (t) => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query("rollback"); await client.end(); });
  await client.query("begin");
  const group = randomUUID(), organization = randomUUID(), other = randomUUID(), actor = randomUUID();
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone) values
    ($1,'Audit group','UTC'),($2,'Unrelated group','UTC')`, [group, other]);
  await client.query(`insert into app_identity.organization(id,name,deployment_timezone,parent_organization_id)
    values($1,'Audit child','UTC',$2)`, [organization, group]);
  await client.query(`insert into app_identity.app_user(id,organization_id,display_name) values($1,$2,'Auditor')`, [actor, group]);
  const event = randomUUID(), report = randomUUID();
  await client.query(`insert into clinical_audit.hospital_operational_event
    (id,organization_id,report_id,integration,verification,source_id,snapshot_id,amendment_sequence,synthetic,
     configuration_revision,mapping_id,mapping_revision,mapping_sha256,actor_id,action,state,occurred_at)
    values($1,$2,$3,'cos','simulator',$4,$5,0,true,1,'fixture',1,$6,$7,'cos.delivery','confirmed',clock_timestamp())`,
  [event, organization, report, randomUUID(), randomUUID(), 'a'.repeat(64), actor]);
  for (const scope of [group, other]) await client.query(`insert into app_identity.configuration_event
    (organization_id,actor_id,catalog_release_id,action,result,change_note,details) values($1,$2,(select id from catalog.release limit 1),'hospital.draft_save','succeeded','Fixture',
     '{"integration":"cos","revision":1,"mappingId":"fixture","mappingOperation":"import"}')`, [scope, actor]);
  await client.query(`insert into app_identity.configuration_event
    (organization_id,actor_id,catalog_release_id,action,result,change_note) values($1,$2,(select id from catalog.release limit 1),'form.draft_save','succeeded','Root-only fixture')`, [group, actor]);
  await client.query(`insert into clinical_audit.synthetic_purge_tombstone
    (record_type,record_id,organization_id,server_created_at,expired_at,purged_at)
    values('report',$1,$2,now()-interval '25 hours',now()-interval '1 hour',clock_timestamp())`, [randomUUID(), organization]);
  let identifying = true;
  const sessions = { requireCapability: async () => ({ user: { id: actor }, organization: { id: organization },
    capabilities: identifying ? ['audit:read','audit:identifying'] : ['audit:read'] }) };
  const manager = { query: async (sql, values) => (await client.query(sql, values)).rows };
  const service = new AuditService({ transaction: async (_isolation, work) => work(manager) }, sessions);
  const range = { from: new Date(Date.now()-86400000).toISOString(), to: new Date(Date.now()+86400000).toISOString() };
  await client.query('set local role open_triage_api_runtime');
  const all = await service.list('fixture', range);
  assert.deepEqual(all.categories, auditCategories);
  assert.equal(all.entries.filter(row => row.id === event).length, 1, 'one canonical event, not a second clinical/review projection');
  assert.equal(all.entries.find(row => row.id === event).category, 'integrations');
  assert.ok(all.entries.some(row => row.action === 'synthetic.purge.report' && row.outcome === 'purged'));
  const configuration = await service.list('fixture', { ...range, category: 'configuration' });
  assert.deepEqual(configuration.entries.map(row => row.action), ['hospital.mapping_import'],
    'include shared hospital settings, excluding other groups and unrelated root settings');
  assert.equal(configuration.entries[0].integration.destination, 'cos');
  const integrations = await service.list('fixture', { ...range, category: 'integrations', uuid: report });
  assert.deepEqual(integrations.entries.map(row => row.id), [event]);
  identifying = false;
  const administrative = await service.list('fixture', range);
  assert.deepEqual(administrative.categories, auditCategories);
  assert.ok(administrative.entries.some(row => row.action === 'hospital.mapping_import'));
  assert.deepEqual((await service.list('fixture', { ...range, category: 'integrations' })).entries.map(row => row.id), [event]);
});
