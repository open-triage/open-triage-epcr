import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { reduceWorkload } from "../dist/review/review-workload.js";
import { ReviewService } from "../dist/review/review.service.js";
import { aggregateRevision, workloadCsv } from "../dist/review/review-csv.js";

const now = new Date("2026-10-02T16:00:00Z");
const rows = [
  { id: "a", report_id: "report-1", reporting_date: "2026-10-01",
    criterion_id: "criterion-a", priority: "high", status: "completed", kind: "criterion",
    report_status: "signed", first_matched_at: "2026-10-01T09:00:00Z", reopened: true,
    resolution_reason: null, exception_code: null, completion_at: "2026-10-02T13:00:00Z",
    reopened_at: "2026-10-02T11:00:00Z" },
  { id: "b", report_id: "report-1", reporting_date: "2026-10-01",
    criterion_id: "criterion-b", priority: "medium", status: "new", kind: "criterion",
    report_status: "signed", first_matched_at: "2026-10-02T08:00:00Z", reopened: false,
    resolution_reason: null, exception_code: null, completion_at: null, reopened_at: null },
  { id: "c", report_id: "report-2", reporting_date: null,
    criterion_id: "overdue", priority: "medium", status: "completed", kind: "overdue-unsigned",
    report_status: "draft", first_matched_at: "2026-10-01T08:00:00Z", reopened: false,
    resolution_reason: "closed-exceptionally", exception_code: "report-not-required",
    completion_at: "2026-10-02T10:00:00Z", reopened_at: null },
];
const definition = (groupBy) => ({ groupBy, filters: {
  from: "2026-10-01", to: "2026-10-02", dataset: "real" } });

test("workload counts items once and uses the latest reopened cycle for duration", () => {
  const result = reduceWorkload(rows, definition("completion-duration"), "all", "org", now);
  assert.equal(result.totalItems, 3);
  assert.equal(result.reopenedItems, 1);
  assert.equal(result.unsignedItems, 1);
  assert.equal(result.exceptionallyClosedItems, 1);
  assert.deepEqual(result.groups, [
    { key: "1-24 hours", count: 1 }, { key: "1-7 days", count: 1 },
    { key: "not completed", count: 1 },
  ]);
  assert.deepEqual(reduceWorkload(rows, definition("criterion"), "all", "org", now).groups,
    [{ key: "criterion-a", count: 1 }, { key: "criterion-b", count: 1 },
      { key: "overdue-unsigned", count: 1 }]);
  assert.deepEqual(reduceWorkload(rows, definition("exception-reason"), "all", "org", now).groups,
    [{ key: "no exception", count: 2 }, { key: "report-not-required", count: 1 }]);
  const csv = workloadCsv(result);
  assert.match(csv, /"population_unit","review-item"/);
  assert.match(csv, /"includes_unsigned","true"/);
  assert.notEqual(aggregateRevision(result), aggregateRevision({ ...result,
    freshness: { ...result.freshness, observedAt: "2026-10-02T16:00:01.000Z" } }));
});

test("workload API validates scope, dataset, bounds, and item counting", async () => {
  const session = { user: { id: randomUUID() }, organization: { id: randomUUID() },
    capabilities: ["review:self"] };
  const calls = [];
  const service = new ReviewService({ query: async (sql, params) => {
    calls.push({ sql, params }); return rows;
  } }, { get: async () => session });
  const result = await service.workload("token", definition("status"));
  assert.equal(result.population.scope, "own");
  assert.equal(result.population.unit, "review-item");
  assert.deepEqual(result.groups, [{ key: "completed", count: 2 }, { key: "new", count: 1 }]);
  assert.match(calls[0].sql, /r.synthetic=\$2/);
  assert.match(calls[0].sql, /r.documenting_user_id=\$4/);
  assert.deepEqual(calls[0].params.slice(0,4), [session.organization.id, false, false, session.user.id]);
  for (const invalid of [definition("invalid"), { ...definition("status"), filters: {
    from: "2020-01-01", to: "2026-10-02", dataset: "real" } },
  { ...definition("status"), filters: { from: "2026-10-01", to: "2026-10-02", dataset: "invalid" } }])
    await assert.rejects(service.workload("token", invalid), { status: 400 });
  const unauthorized = new ReviewService({ query: async () => rows },
    { get: async () => ({ ...session, capabilities: [] }) });
  await assert.rejects(unauthorized.workload("token", definition("status")), { status: 403 });
});
