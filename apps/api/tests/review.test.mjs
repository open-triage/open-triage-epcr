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
    if (sql.includes("from clinical.review_item item")) return [];
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

test("volume validates filters, binds both scope dimensions, and suppresses stale counts", async () => {
  const calls = [];
  let stale = false;
  let partial = false;
  let current = session(["review:self"]);
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("projection_health")) return [{ observed_at: "2026-10-02T12:00:00Z",
      oldest_backlog_age_seconds: stale ? 301 : null, persistent_failure_count: 0, retrying_count: 0,
      stale_run_count: 0, last_run_status: partial ? "partial" : "succeeded", is_read_only_replica: false,
      replay_lag_seconds: null }];
    return [{ date: "2026-10-01", count: "2" }, { date: "2026-10-02", count: "0" }];
  } };
  const service = new ReviewService(database, { get: async () => current });
  const result = await service.volume("token", "real", "2026-10-01", "2026-10-02");
  assert.equal(result.total, 2);
  assert.deepEqual(result.definition.filters, { from: "2026-10-01", to: "2026-10-02", dataset: "real" });
  assert.equal(result.population.unit, "patient-report");
  assert.deepEqual(calls[1].params, ["2026-10-01", "2026-10-02", "org-a", false, false, "user-a"]);
  assert.match(calls[1].sql, /source\.organization_id = \$3/);
  assert.match(calls[1].sql, /source\.synthetic = \$4/);
  assert.match(calls[1].sql, /source\.documenting_user_id = \$6/);
  assert.match(calls[1].sql, /count\(source\.report_id\)/);
  current = session(["review:all", "clinical:demo"], "user-b", "org-b");
  const all = await service.volume("token", undefined, "2026-10-01", "2026-10-02");
  assert.equal(all.population.scope, "all");
  assert.deepEqual(calls[3].params.slice(2), ["org-b", true, true, "user-b"]);
  stale = true;
  const before = calls.length;
  const withheld = await service.volume("token", "real", "2026-10-01", "2026-10-02");
  assert.equal(withheld.total, null);
  assert.deepEqual(withheld.points, []);
  assert.equal(calls.length, before + 1);
  stale = false;
  partial = true;
  assert.equal((await service.volume("token", "real", "2026-10-01", "2026-10-02")).total, null);
  await assert.rejects(service.volume("token", "both", "2026-10-01", "2026-10-02"), BadRequestException);
  await assert.rejects(service.volume("token", "real", "2026-02-30", "2026-10-02"), BadRequestException);
  await assert.rejects(service.volume("token", "real", "2026-10-02", "2026-10-01"), BadRequestException);
});

test("review queue filters are scoped before pagination and report links", async () => {
  const calls = [];
  const database = { async query(sql, params) {
    calls.push({ sql, params });
    return sql.includes("count(*)") ? [{ total: "1" }] : [{ id: "item-a", report_id: "report-a",
      criterion_id: "rule-a", priority: "high", status: "new", assignee_id: null, version: "0",
      first_matched_at: "2026-10-02T10:00:00Z", reporting_date: "2026-10-02",
      signed_at: "2026-10-02T09:00:00Z", findings: [{ message: "Review" }] }];
  } };
  const service = new ReviewService(database, { get: async () => session(["review:self"]) });
  const result = await service.queue("token", { dataset: "real", priority: "high", status: "new",
    from: "2026-10-01", to: "2026-10-02", page: "2", pageSize: "10" });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].reportId, "report-a");
  assert.equal(result.items[0].version, 0);
  assert.deepEqual(calls[0].params.slice(0, 9), ["org-a", false, false, "user-a", null,
    "high", "new", "2026-10-01", "2026-10-02"]);
  assert.match(calls[0].sql, /r\.documenting_user_id=\$4/);
  assert.match(calls[1].sql, /limit \$10 offset \$11/);
  assert.deepEqual(calls[1].params.slice(9), [10, 10]);
  await assert.rejects(service.queue("token", { priority: "critical" }), BadRequestException);
});

test("claim requires review-all, CSRF, current unassigned version, and replays once", async () => {
  let current = session(["review:all"]);
  const item = { version: 0, status: "new", assignee_id: null };
  const history = [];
  const manager = { async query(sql, params) {
    if (sql.includes("from clinical.review_item i") && sql.includes("for update")) return [{ ...item }];
    if (sql.includes("from clinical.review_assignment_history where item_id"))
      return history.filter((event) => event.command_id === params[1]);
    if (sql.includes("update clinical.review_item set")) {
      item.version++; item.assignee_id = params[1]; return [];
    }
    if (sql.includes("insert into clinical.review_assignment_history")) {
      history.push({ command_id: params[2], actor_id: params[3], assignee_id: params[3], item_version: params[4] });
      return [];
    }
    throw new Error(`unexpected query: ${sql}`);
  } };
  let transactionTail = Promise.resolve();
  const database = { transaction: async (work) => {
    const prior = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await prior;
    try { return await work(manager); } finally { release(); }
  }, query: async (sql) =>
    sql.includes("from clinical.review_progress_history") ? [] :
    sql.includes("from clinical.review_assignment_history") ? history.map((event) => ({
      ...event, assigned_at: "2026-10-02T10:00:00Z" })) : [{ id: "item-a", report_id: "report-a",
      criterion_id: "criterion-a", priority: "high", status: item.status,
      assignee_id: item.assignee_id, version: String(item.version),
      first_matched_at: "2026-10-02T09:00:00Z", reporting_date: "2026-10-02",
      signed_at: "2026-10-02T09:00:00Z", findings: [] }] };
  const service = new ReviewService(database, { get: async () => current,
    assertCsrf: async (_token, csrf) => { if (csrf !== "valid") throw new ForbiddenException(); } });
  const command = { commandId: "123e4567-e89b-42d3-a456-426614174000", expectedVersion: 0, dataset: "real" };
  current = session(["review:self"]);
  await assert.rejects(service.claim("token", "item-a", command, "valid"), ForbiddenException);
  current = session(["review:all"]);
  await assert.rejects(service.claim("token", "item-a", command), ForbiddenException);
  assert.equal((await service.claim("token", "item-a", command, "valid")).assigneeId, "user-a");
  assert.equal(history.length, 1);
  assert.equal((await service.claim("token", "item-a", command, "valid")).assignmentHistory.length, 1);
  await assert.rejects(service.claim("token", "item-a", { ...command,
    commandId: "123e4567-e89b-42d3-a456-426614174001" }, "valid"), { status: 409 });
  current = session(["review:all"], "user-b");
  await assert.rejects(service.claim("token", "item-a", command, "valid"), { status: 409 });
  assert.equal(history.length, 1);
  item.version = 0; item.assignee_id = null; history.length = 0;
  const contenders = ["user-a", "user-b"].map((userId, index) => {
    const contender = new ReviewService(database, { get: async () => session(["review:all"], userId),
      assertCsrf: async () => {} });
    return contender.claim("token", "item-a", { ...command,
      commandId: `123e4567-e89b-42d3-a456-42661417400${index + 2}` }, "valid");
  });
  const outcomes = await Promise.allSettled(contenders);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
  assert.equal(history.length, 1);
});

test("only review administrators can inspect processing failures", async () => {
  const database = { query: async () => [] };
  let current = session(["review:all"]);
  const service = new ReviewService(database, { get: async () => current });
  await assert.rejects(service.backlog("token"), ForbiddenException);
  current = session(["review:all", "review:admin"]);
  assert.deepEqual((await service.backlog("token")).work, []);
});

test("Review routing is admin-only, versioned, replay-safe, and validates named reviewers", async () => {
  const criterionId = "123e4567-e89b-42d3-a456-426614174021";
  const namedId = "123e4567-e89b-42d3-a456-426614174022";
  let current = session(["review:all"]);
  let eligible = true;
  const state = { route: "unassigned", named_user_id: null, version: 0 };
  const history = [];
  const manager = { async query(sql, params) {
    if (sql.includes("from validation.version v")) return [{ id: "published" }];
    if (sql.includes("insert into clinical.review_criterion_route (")) return [];
    if (sql.includes("select version from clinical.review_criterion_route")) return [{ version: String(state.version) }];
    if (sql.includes("from clinical.review_criterion_route_history"))
      return history.filter((event) => event.command_id === params[1]);
    if (sql.includes("from app_identity.app_user u")) return eligible ? [{ id: namedId,
      display_name: "Reviewer", all_access: true, self_access: false }] : [];
    if (sql.includes("update clinical.review_criterion_route set")) {
      state.route = params[2]; state.named_user_id = params[3]; state.version++; return [];
    }
    if (sql.includes("insert into clinical.review_criterion_route_history")) {
      history.push({ command_id: params[2], actor_id: params[3], route: params[4],
        named_user_id: params[5], route_version: params[6] }); return [];
    }
    throw new Error(`Unexpected query ${sql}`);
  } };
  const database = { transaction: async (work) => work(manager), query: async () => [{
    criterion_id: criterionId, name: "Criterion", route: state.route,
    named_user_id: state.named_user_id, version: String(state.version), recovery_reason: null,
  }] };
  const service = new ReviewService(database, { get: async () => current, assertCsrf: async () => {} });
  const command = { commandId: "123e4567-e89b-42d3-a456-426614174023",
    expectedVersion: 0, route: "named", namedUserId: namedId };
  await assert.rejects(service.configureRoute("token", criterionId, command, "valid"), { status: 403 });
  await assert.rejects(service.routes("token"), { status: 403 });
  current = session(["review:all", "review:admin"]);
  assert.equal((await service.routes("token"))[0].route, "unassigned");
  assert.equal((await service.configureRoute("token", criterionId, command, "valid")).route, "named");
  assert.equal(history.length, 1);
  assert.equal((await service.configureRoute("token", criterionId, command, "valid")).version, 1);
  assert.equal(history.length, 1);
  await assert.rejects(service.configureRoute("token", criterionId,
    { ...command, commandId: "123e4567-e89b-42d3-a456-426614174024" }, "valid"), { status: 409 });
  eligible = false;
  await assert.rejects(service.configureRoute("token", criterionId,
    { ...command, expectedVersion: 1, commandId: "123e4567-e89b-42d3-a456-426614174025" }, "valid"),
  { status: 400 });
  assert.equal(history.length, 1);
});
