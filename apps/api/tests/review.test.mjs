import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReviewService } from "../dist/review/review.service.js";
import { reviewScope } from "../dist/review/review-scope.js";

test("signed inspection applies amendments and withholds unrestricted content", async () => {
  const queries = [];
  let capabilities = ["review:self"];
  let reportVisible = true;
  const manager = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes("from clinical.report r join clinical.signed_snapshot")) return reportVisible ? [{
      id: "report-a", reporting_date: "2026-10-02", signed_at: "2026-10-02T08:00:00Z", catalog_release_id: "release-a",
    }] : [];
    if (sql.includes("from clinical.group_instance gi")) return [{ id: "group-a", parent_group_instance_id: null,
      group_id: "custom.entry", label: "Assessment entry", ordinal: 1 }];
    if (sql.includes("from clinical.element_occurrence o")) return [
      { occurrence: { id: "old", element_identity_id: "identity-a", element_id: "custom.score",
        group_instance_id: "group-a", ordinal: 0, value_kind: "integer", value_integer: 2 },
        label: "Score", identifying: false },
      { occurrence: { id: "narrative", element_identity_id: "identity-b", element_id: "custom.narrative",
        group_instance_id: "group-a", ordinal: 0, value_kind: "text", value_text: "Patient name" },
        label: "Narrative", identifying: false },
      { occurrence: { id: "identity", element_identity_id: "identity-c", element_id: "ePatient.02",
        group_instance_id: null, ordinal: 0, value_kind: "text", value_text: "Surname" },
        label: "Last name", identifying: true },
    ];
    if (sql.includes("from catalog.element_definition ed")) return [{ element_identity_id: "identity-a",
      label: "Score", identifying: false }];
    if (sql.includes("from clinical.amendment a")) return [{ action: "replace", target_element_occurrence_id: "old",
      corrected_value: { id: "old", value_integer: 4 }, sequence: 1 }];
    if (sql.includes("from clinical.report_note note") || sql.includes("from clinical.report_photo_note note") ||
        sql.includes("from clinical.report_audio_note note")) return [];
    throw new Error(`unexpected query ${sql}`);
  } };
  const service = new ReviewService({ transaction: async (level, callback) =>
    (typeof level === "function" ? level : callback)(manager) },
    { get: async () => session(capabilities) });
  const report = await service.report("token", "report-a");
  assert.equal(report.amendmentSequence, 1);
  assert.deepEqual(report.groups.map(({ id, label }) => [id, label]), [["group-a", "Assessment entry"]]);
  assert.deepEqual(report.values.map(({ id, value, groupInstanceId }) => [id, value, groupInstanceId]),
    [["old", 4, "group-a"]]);
  assert.deepEqual(report.notes, []);
  assert.match(queries[0].sql, /r\.organization_id = \$2/);
  assert.match(queries[0].sql, /r\.synthetic = \$3/);
  assert.match(queries[0].sql, /r\.status = 'signed'/);
  assert.deepEqual(queries[0].params.slice(1), ["org-a", false, false, "user-a"]);
  await assert.rejects(service.media("token", "report-a", "note-a", "photo"), ForbiddenException);
  capabilities = ["review:self", "review:identifying"];
  const identified = await service.report("token", "report-a");
  assert.equal(identified.values.length, 3);
  assert.equal(identified.values.find(({ id }) => id === "identity").value, "Surname");
  reportVisible = false;
  await assert.rejects(service.report("token", "report-a"), { status: 404 });
  await assert.rejects(service.media("token", "report-a", "note-a", "photo"), { status: 404 });
  reportVisible = true;
  capabilities = [];
  await assert.rejects(service.report("token", "report-a"), ForbiddenException);
  await assert.rejects(service.media("token", "report-a", "note-a", "audio"), ForbiddenException);
});

const session = (capabilities, userId = "user-a", organizationId = "org-a") => ({
  capabilities, user: { id: userId }, organization: { id: organizationId },
});

test("Review scope separates report access, identifying content, and administration", () => {
  assert.throws(() => reviewScope(session(["review:identifying"])), ForbiddenException);
  assert.deepEqual(reviewScope(session(["review:self", "review:identifying"])), {
    organizationId: "org-a", userId: "user-a", reports: "own", identifying: true,
    administrator: false, defaultDataset: "real",
  });
  assert.deepEqual(reviewScope(session(["review:all", "review:admin", "clinical:demo"])), {
    organizationId: "org-a", userId: "user-a", reports: "all", identifying: false,
    administrator: true, defaultDataset: "synthetic",
  });
});

test("signed report query applies organization, user, signature and dataset scope on every page", async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    return sql.includes("count(*)") ? [{ total: "1" }] : [{
      id: "report-a", reporting_date: "2026-10-02", signed_at: "2026-10-02T08:00:00Z", author_name: null,
    }];
  } };
  let current = session(["review:self"]);
  const service = new ReviewService(database, { get: async () => current });
  const first = await service.signedReports("token");
  assert.equal(first.dataset, "real");
  assert.equal(first.scope, "own");
  assert.equal(first.reports[0].documentingClinician, undefined);
  assert.equal(calls.length, 2);
  for (const { sql, params } of calls) {
    assert.match(sql, /r\.organization_id = \$1/);
    assert.match(sql, /r\.synthetic = \$2/);
    assert.match(sql, /r\.status = 'signed'/);
    assert.match(sql, /r\.documenting_user_id = \$3/);
    assert.deepEqual(params.slice(0, 4), ["org-a", false, "user-a", false]);
  }
  calls.length = 0;
  current = session(["review:all", "review:identifying", "clinical:demo"], "user-b", "org-b");
  const second = await service.signedReports("token", undefined, "2", "10");
  assert.equal(second.dataset, "synthetic");
  assert.equal(second.scope, "all");
  assert.deepEqual(calls[1].params, ["org-b", true, "user-b", true, 10, 10, true]);
  await assert.rejects(service.signedReports("token", "both"), BadRequestException);
  await assert.rejects(service.signedReports("token", "real", "0"), BadRequestException);
});
