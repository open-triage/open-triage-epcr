import assert from "node:assert/strict";
import test from "node:test";
import { ReviewService } from "../dist/review/review.service.js";

const health = { observed_at: new Date(), oldest_backlog_age_seconds: null,
  persistent_failure_count: 0, retrying_count: 0, stale_run_count: 0,
  last_run_status: "succeeded", is_read_only_replica: false, replay_lag_seconds: null };
const session = { user: { id: "11111111-1111-4111-8111-111111111111" },
  organization: { id: "22222222-2222-4222-8222-222222222222" }, capabilities: ["review:self"] };
const definition = (overrides = {}) => ({ fieldId: "eSituation.11", operation: "distribution",
  filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" }, ...overrides });

test("Review field discovery is authorized and excludes free-text and identifying fields", async () => {
  let active = session;
  const service = new ReviewService({ query: async () => [] }, { get: async () => active });
  const fields = await service.analysisFields("token");
  assert.ok(fields.some((field) => field.id === "eSituation.11"));
  assert.ok(fields.some((field) => field.id === "eExam.01" && field.unit === "kg"));
  assert.ok(!fields.some((field) => field.id === "eSituation.04"));
  assert.ok(!fields.some((field) => field.id === "eDisposition.03"));
  active = { ...session, capabilities: [] };
  await assert.rejects(service.analysisFields("token"), { status: 403 });
});

test("Review distribution preserves missing, absence, and report denominators", async () => {
  const queries = [];
  const service = new ReviewService({ query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes("projection_health")) return [health];
    return [
      { group_value: null, field_value: null, absent: false, count: "2" },
      { group_value: null, field_value: null, absent: true, count: "1" },
      { group_value: null, field_value: "A", absent: false, count: "3" },
      { group_value: null, field_value: "B", absent: false, count: "2" },
    ];
  } }, { get: async () => session });
  const result = await service.analysis("token", definition({
    groupBy: "eDisposition.30",
    filters: { from: "2026-10-01", to: "2026-10-02", dataset: "synthetic",
      field: { id: "eSituation.09", value: "C" } },
  }));
  assert.deepEqual(result.groups[0], { group: null, denominator: 8, missing: 2, absent: 1,
    values: [{ value: "A", count: 3, percentage: 37.5 },
      { value: "B", count: 2, percentage: 25 }], summary: null });
  assert.equal(result.population.scope, "own");
  assert.deepEqual(queries[1].parameters.slice(2), [session.organization.id, true, false,
    session.user.id, "eSituation.11", "eDisposition.30", "eSituation.09", "C"]);
  assert.match(queries[1].sql, /source.organization_id = \$3::uuid/);
  assert.match(queries[1].sql, /limit 501/);
});

test("Review numeric summaries retain units and null values", async () => {
  const service = new ReviewService({ query: async (sql) => sql.includes("projection_health")
    ? [health] : [{ group_value: "A", denominator: "4", missing: "1", absent: "1",
      value_count: "2", mean: "72.5", median: "72.5", minimum: "65", maximum: "80" }] },
  { get: async () => session });
  for (const [operation, expected] of [["mean", 72.5], ["median", 72.5],
    ["minimum", 65], ["maximum", 80]]) {
    const result = await service.analysis("token", definition({ fieldId: "eExam.01", operation,
      groupBy: "eSituation.11" }));
    assert.equal(result.field.unit, "kg");
    assert.equal(result.groups[0].summary, expected);
    assert.equal(result.groups[0].missing, 1);
    assert.equal(result.groups[0].absent, 1);
  }
});

test("Review rejects prohibited fields, invalid operations, and unbounded dates", async () => {
  const service = new ReviewService({ query: async () => [health] }, { get: async () => session });
  for (const invalid of [
    definition({ fieldId: "eSituation.04" }),
    definition({ fieldId: "eDisposition.03" }),
    definition({ fieldId: "eExam.01", operation: "distribution" }),
    definition({ groupBy: "eExam.01" }),
    definition({ filters: { from: "2025-01-01", to: "2026-10-02", dataset: "real" } }),
    definition({ filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real",
      field: { id: "eDisposition.03", value: "secret" } } }),
  ]) await assert.rejects(service.analysis("token", invalid), { status: 400 });
  const noAccess = new ReviewService({ query: async () => [health] },
    { get: async () => ({ ...session, capabilities: [] }) });
  await assert.rejects(noAccess.analysis("token", definition()), { status: 403 });
});

test("repeated numeric analysis requires a reducer and keeps the scoped source query", async () => {
  const queries = [];
  const service = new ReviewService({ query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes("projection_health")) return [health];
    return [{ report_id: "r1", group_value: null, occurrence_id: "o1", group_id: "g", group_instance_id: "g1",
      parent_group_instance_id: null,
      group_ordinal: 1, element_ordinal: 1, clinical_time: null, documented_time: null,
      code: null, numeric_value: "100", unit_code: "mm[Hg]", absence_kind: null,
      absence_code: null, normalization_rule_id: null,
      quality_flags: null }];
  } }, { get: async () => session });
  await assert.rejects(service.analysis("token", definition({ fieldId: "eVitals.06",
    operation: "mean" })), { status: 400 });
  const result = await service.analysis("token", definition({ fieldId: "eVitals.06",
    operation: "mean", reducer: "first" }));
  assert.equal(result.groups[0].summary, 100);
  assert.equal(result.sources[0].sourceValues[0].occurrenceId, "o1");
  assert.match(queries[1].sql, /source.organization_id = \$3::uuid/);
  assert.match(queries[1].sql, /source.synthetic = \$4::boolean/);
  assert.match(queries[1].sql, /source.documenting_user_id = \$6::uuid/);
});

test("a repeated category filter works for a wide-field measure without report fan-out", async () => {
  const queries = [];
  const service = new ReviewService({ query: async (sql) => {
    queries.push(sql);
    if (sql.includes("projection_health")) return [health];
    return [{ group_value: null, field_value: "A", absent: false, count: "2" }];
  } }, { get: async () => session });
  const result = await service.analysis("token", definition({ filters: {
    from: "2026-10-01", to: "2026-10-02", dataset: "real",
    field: { id: "eMedications.03", value: "drug-A" },
  } }));
  assert.equal(result.groups[0].denominator, 2);
  assert.match(queries[1], /from analytics.review_field_source_with_identity source/);
  assert.match(queries[1], /exists \(select 1 from analytics.review_repeated_field_source f/);
});
