import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { recordAnalyticsAccess } from "../dist/review/analytics-access-audit.js";
import { ReviewController } from "../dist/review/review.controller.js";
import { aggregateRevision } from "../dist/review/review-csv.js";

test("analytics evidence commits the validated request and unique report references together without arbitrary request fields", async () => {
  const scope = { organizationId: randomUUID(), userId: randomUUID(), reports: "all", identifying: false, defaultDataset: "real" };
  const reportId = randomUUID(), eventId = randomUUID();
  let committed = [], fail = false;
  const primary = { transaction: async (level, work) => {
    assert.equal(level, "REPEATABLE READ");
    const pending = [];
    const result = await work({ query: async (sql, params) => {
      pending.push({ sql, params });
      if (sql.includes("insert into clinical_audit.analytics_access_event")) return [[{ id: eventId }], 1];
      if (sql.includes("with recorded_access")) return [{ recorded: fail ? 0 : 1 }];
      return [];
    } });
    committed.push(...pending); return result;
  } };
  const input = { surface: "analytics", operation: "query", dataset: "real", from: "2026-10-01", through: "2026-10-02",
    reportIds: [reportId, reportId], request: { search: 'Long search with "quotes" and åäö', page: 2 },
    filters: { surname: "never retain this" }, token: "secret" };
  await recordAnalyticsAccess(primary, scope, input);
  assert.deepEqual(committed.at(-1).params[4], [reportId]);
  assert.equal(committed.at(-1).params[3], eventId);
  assert.deepEqual(JSON.parse(committed.find(row => row.sql.includes("insert into clinical_audit.analytics_access_event")).params[11]), input.request);
  assert.doesNotMatch(JSON.stringify(committed), /never retain this|secret/);
  const count = committed.length;
  fail = true;
  await assert.rejects(recordAnalyticsAccess(primary, scope, input), { status: 503 });
  assert.equal(committed.length, count, "a missing report rolls back the whole audit batch");
  await recordAnalyticsAccess(primary, scope, { ...input, reportIds: [] });
  assert.equal(committed.at(-1).params[10], 0, "empty populations still have a query event");
});

test("every legacy CSV path awaits an export audit and releases no CSV when logging fails", async () => {
  const filters = { from: "2026-10-01", to: "2026-10-02", dataset: "real" };
  const base = { population: { organizationId: randomUUID(), scope: "all" },
    freshness: { status: "current", observedAt: "2026-10-02T00:00:00.000Z" }, sources: [] };
  const results = {
    analysis: { ...base, definition: { fieldId: "field", operation: "distribution", filters }, field: { id: "field", label: "field" }, groups: [] },
    volume: { ...base, definition: { measure: "signed-report-count", grouping: "day", filters }, points: [], total: 0 },
    workload: { ...base, definition: { groupBy: "status", filters }, groups: [], totalItems: 0 },
  };
  for (const [surface, result] of Object.entries(results)) for (const records of [false, true]) {
    let audited = false, fail = false;
    const controller = new ReviewController({ [surface]: async () => result, auditExport: async (_token, category, kind) => {
      assert.equal(category, `review.${surface}`); assert.equal(kind, records ? "records" : "aggregate");
      if (fail) throw new Error("audit unavailable"); audited = true;
    } });
    const method = `export${surface[0].toUpperCase()}${surface.slice(1)}${records ? "Records" : ""}`;
    const request = { definition: result.definition, expectedRevision: aggregateRevision(result), displayedObservedAt: base.freshness.observedAt };
    const response = { setHeader() {}, send() { assert.equal(audited, true); } };
    await controller[method](request, "Bearer token", undefined, response);
    fail = true; audited = false;
    await assert.rejects(controller[method](request, "Bearer token", undefined, { ...response, send() { assert.fail("unaudited CSV"); } }), /audit unavailable/);
    fail = false;
    await assert.rejects(controller[method]({ ...request, expectedRevision: "a".repeat(64) }, "Bearer token", undefined, response), { status: 409 });
    assert.equal(audited, false, "revision conflicts are not successful exports");
  }
});
