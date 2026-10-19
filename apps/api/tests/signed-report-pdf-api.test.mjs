import assert from "node:assert/strict";
import test from "node:test";
import { ReviewService } from "../dist/review/review.service.js";
import { signedReportPdfSource } from "../dist/reports/signed-report-pdf.persistence.js";
import { commandSha256 } from "../dist/reports/draft-report.validation.js";
import { signedPdfFixture } from "./fixtures/signed-pdf-source.mjs";
import { SignReportService } from "../dist/reports/sign-report.service.js";

function fixture() {
  const { source, manifest } = signedPdfFixture();
  const state = { capabilities: ["review:self"], organizationId: "org-a", userId: source.signerId, synthetic: true,
    revoked: false, visible: true, manifest, customAvailable: true, evidenceMode: "valid", audit: [], queries: [] };
  const manager = { async query(sql, params) {
    state.queries.push({ sql, params });
    if (sql.includes("from clinical.report r join clinical.signed_snapshot")) {
      assert.deepEqual(params.slice(1), [state.organizationId, true, state.capabilities.includes("review:all"), state.userId]);
      return state.visible && state.organizationId === "org-a" && state.synthetic &&
        (state.capabilities.includes("review:all") || state.userId === source.signerId) ? [{ id: source.reportId,
          signed_snapshot_id: source.snapshotId, documenting_user_id: source.signerId, signed_at: source.signedAt,
          catalog_release_id: source.catalogReleaseId, form_version_id: source.formVersionId }] : [];
    }
    if (sql.includes("from clinical.signed_snapshot s")) return params[0] === source.reportId && params[1] === source.snapshotId ? [{
      id: source.snapshotId, signed_revision: source.revision, signer_id: source.signerId, signed_at: source.signedAt,
      canonical_sha256: source.canonicalSha256, integrity_manifest: state.manifest,
      catalog_release_id: source.catalogReleaseId, form_version_id: source.formVersionId, synthetic: true }] : [];
    if (sql.includes("from clinical.amendment a")) {
      assert.match(sql, /a.sequence <= \$2/);
      return source.amendments.filter((item) => item.sequence <= params[1]).map((item) => {
        const changes = item.changes.map((change) => ({ action: change.action,
          targetElementOccurrenceId: change.targetId, targetPath: {},
          originalValue: change.original, correctedValue: change.corrected }));
        const attestation = { confirmed: true };
        const digest = commandSha256({ schemaVersion: 1, reportId: source.reportId, amendmentId: item.id,
          sequence: item.sequence, authorId: item.authorId, reason: item.reason, attestation, signedAt: item.signedAt, changes });
        const evidence = { amendmentId: item.id, amendmentSequence: item.sequence, canonicalSha256: digest,
          reason: item.reason, changes: structuredClone(changes) };
        if (state.evidenceMode === "tampered") evidence.changes[0].correctedValue.value_integer = 999;
        return { ...item, author_id: item.authorId, signed_at: item.signedAt, canonical_sha256: digest, attestation,
          changes: state.evidenceMode === "extra-row" ? [...changes, changes[0]] : [...changes].reverse(),
          audit_manifests: state.evidenceMode === "missing" ? null : state.evidenceMode === "duplicate" ? [evidence, evidence] : [evidence] };
      });
    }
    if (sql.includes("select canonical_definition from forms.form_version")) {
      assert.deepEqual(params, [source.formVersionId, source.catalogReleaseId]);
      return [{ canonical_definition: { schemaVersion: 1, sections: [] } }];
    }
    if (sql.includes("as definitions")) return [{ definitions: state.customAvailable ? Object.values(source.configuration.customFields) : [] }];
    if (sql.includes("from catalog.group_definition g")) return [{ group_id: "eVitals.VitalGroup", name: "Vital signs" }];
    if (sql.includes("with wording as materialized")) return Object.entries(source.configuration.catalogFields).map(([element_id, field]) => ({
      element_id, name: field.name, localization: field.localization, min_occurs: 0, max_occurs: null, nillable: true,
    }));
    if (sql.includes("select group_id, name")) return [{ group_id: "eVitals.VitalGroup", name: "Vital signs" }];
    if (sql.includes("with recorded_access")) { state.audit.push(params); return [{ recorded: 1 }]; }
    if (sql.includes("from catalog.") || sql.includes("from forms.")) return [];
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const sessions = { get: async () => {
    if (state.revoked) throw Object.assign(new Error("revoked"), { status: 401 });
    return { capabilities: state.capabilities, organization: { id: state.organizationId }, user: { id: state.userId } };
  } };
  const service = new ReviewService({ transaction: async (level, fn) => { assert.equal(level, "REPEATABLE READ"); return fn(manager); } }, sessions);
  const call = (overrides = {}) => service.signedPdf("token", overrides.reportId ?? source.reportId,
    overrides.snapshotId ?? source.snapshotId, overrides.sequence ?? "1", overrides.language ?? "en", "synthetic");
  return { source, state, manager, call };
}

test("PDF inspection authorizes live report-relative identifying access and records patient access", async () => {
  const { source, state, call } = fixture();
  const bytes = await call();
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(state.audit.length, 1);
  assert.equal(state.audit[0][6], source.snapshotId);
  state.capabilities = ["review:all"]; state.userId = "other";
  await assert.rejects(call(), { status: 403 });
  state.capabilities.push("review:identifying");
  assert.equal((await call()).subarray(0, 5).toString(), "%PDF-");
  state.revoked = true;
  await assert.rejects(call(), { status: 401 });
});

test("PDF denies guessed artifacts, wrong agency/dataset, own-only other report and missing report authority", async () => {
  const { state, call } = fixture();
  await assert.rejects(call({ snapshotId: "88888888-8888-4888-8888-888888888888" }), { status: 404 });
  state.organizationId = "org-b"; await assert.rejects(call(), { status: 404 }); state.organizationId = "org-a";
  state.synthetic = false; await assert.rejects(call(), { status: 404 }); state.synthetic = true;
  state.userId = "other"; await assert.rejects(call(), { status: 404 });
  state.capabilities = ["review:identifying"]; await assert.rejects(call(), { status: 403 });
  assert.equal(state.audit.length, 0);
});

test("PDF version validation and integrity fail before bytes or patient access are returned", async () => {
  const { source, state, call } = fixture();
  for (const sequence of ["-1", "01", "1.5", "9007199254740992", ""]) await assert.rejects(call({ sequence }), { status: 400 });
  await assert.rejects(call({ language: "xx" }), { status: 400 });
  await assert.rejects(call({ sequence: "2" }), { status: 404 });
  state.manifest = { ...state.manifest, notes: [] };
  await assert.rejects(call(), { status: 422 });
  assert.equal(state.audit.length, 0);
  state.manifest = signedPdfFixture().manifest;
  state.customAvailable = false;
  await assert.rejects(call(), { status: 422 });
  assert.equal(source.occurrences.find((value) => value.id === "pulse-0").value_integer, 88);
});

test("version projection never loads live draft content, notes or mutable custom labels", async () => {
  const { source, manager, state } = fixture();
  const original = await signedReportPdfSource(manager, source.reportId, source.snapshotId, 0);
  assert.equal(original.amendmentSequence, 0);
  assert.equal(original.amendments.length, 0);
  assert.equal(original.occurrences.find((value) => value.id === "pulse-0").value_integer, 88);
  assert.ok(state.queries.every(({sql}) => !sql.includes("from clinical.element_occurrence") && !sql.includes("from clinical.report_note")));
  const query = state.queries.find(({sql}) => sql.includes("as definitions"));
  assert.equal(query.params[0], source.catalogReleaseId);
});

test("signing pins supplemental missing-value distinctions in the canonical manifest", async () => {
  const service = new SignReportService({}, {});
  const occurrence = { id: "value", element_id: "eVitals.10", value_kind: "integer", value_integer: 80,
    not_value_code: "7701001", not_value_display: "Not recorded", pertinent_negative_code: "8801001", pertinent_negative_display: "Not applicable" };
  const payload = await service.canonicalPayload({ query: async (sql) => {
    assert.match(sql, /not_value_code, not_value_display/);
    assert.match(sql, /pertinent_negative_code, pertinent_negative_display/);
    return [{ groups: [], occurrences: [occurrence] }];
  } }, { id: "report", form_version_id: "form", catalog_release_id: "catalog" }, 1, []);
  assert.equal(payload.clinicalContentVersion, 2);
  assert.deepEqual(payload.occurrences[0], occurrence);
  assert.notEqual(commandSha256(payload), commandSha256({ ...payload, occurrences: [{ ...occurrence, not_value_code: null }] }));
});


test("legacy eligibility uses proven content rather than a blanket schema-version cutoff", async () => {
  const { source, state, call } = fixture();
  delete state.manifest.clinicalContentVersion;
  delete state.manifest.report.signer;
  source.canonicalSha256 = commandSha256(state.manifest);
  assert.equal((await call()).subarray(0, 5).toString(), "%PDF-");
  delete state.manifest.occurrences[0].not_value_code;
  source.canonicalSha256 = commandSha256(state.manifest);
  await assert.rejects(call(), { status: 422 });
  // An older notes-only snapshot has no ambiguous occurrence qualifiers.
  state.manifest.occurrences = [];
  source.canonicalSha256 = commandSha256(state.manifest);
  assert.equal((await call({ sequence: "0" })).subarray(0, 5).toString(), "%PDF-");
  delete state.manifest.notes;
  source.canonicalSha256 = commandSha256(state.manifest);
  await assert.rejects(call({ sequence: "0" }), { status: 422 });
});


test("amended PDF requires ordered signed audit evidence and the exact immutable change set", async () => {
  const { state, call } = fixture();
  for (const mode of ["missing", "duplicate", "extra-row", "tampered"]) {
    state.evidenceMode = mode;
    await assert.rejects(call(), (error) => error.status === 422 &&
      error.response.code === "pdf.amendment-evidence-unavailable");
    assert.equal(state.audit.length, 0);
  }
  // A snapshot-only inspection does not depend on later amendment evidence.
  assert.equal((await call({ sequence: "0" })).subarray(0, 5).toString(), "%PDF-");
});


test("amendment verification uses signing audit order instead of random change row order", async () => {
  const { source, manager } = fixture();
  const original = source.occurrences.find((item) => item.id === "pulse-1");
  source.amendments[0].changes.push({ action: "replace", targetId: original.id,
    original: structuredClone(original), corrected: { ...original, value_integer: 81 } });
  const verified = await signedReportPdfSource(manager, source.reportId, source.snapshotId, 1);
  assert.deepEqual(verified.amendments[0].changes.map((change) => change.targetId), ["pulse-0", "pulse-1"]);
});
