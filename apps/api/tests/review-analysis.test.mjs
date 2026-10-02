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
    if (sql.includes("review_custom_dictionary")) return [];
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
  const analysisQuery = queries.find(({ sql }) => sql.includes("review_field_source"));
  assert.deepEqual(analysisQuery.parameters.slice(2), [session.organization.id, true, false,
    session.user.id, "eSituation.11", "eDisposition.30", "eSituation.09", "C"]);
  assert.match(analysisQuery.sql, /source.organization_id = \$3::uuid/);
  assert.match(analysisQuery.sql, /limit 501/);
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

test("operational time measures retain endpoint context, scope, and invalid denominators", async () => {
  const queries = [];
  const service = new ReviewService({ query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes("review_custom_dictionary")) return [];
    if (sql.includes("projection_health")) return [health];
    return [{ group_value: "A", denominator: "5", missing: "1", absent: "1", invalid: "1",
      mean: "12.5", median: "12.5", minimum: "10", maximum: "15" }];
  } }, { get: async () => session });
  const fields = await service.analysisFields("token");
  for (const [id, start, end] of [
    ["review.duration.response", "eTimes.03", "eTimes.06"],
    ["review.duration.scene", "eTimes.06", "eTimes.09"],
    ["review.duration.transport", "eTimes.09", "eTimes.11"],
  ]) assert.deepEqual(fields.find((field) => field.id === id)?.interval,
    { start, end, eligibility: "signed-patient-reports" });
  const result = await service.analysis("token", definition({ fieldId: "review.duration.response",
    operation: "mean", groupBy: "eSituation.11", filters: { from: "2026-10-01",
      to: "2026-10-02", dataset: "real", field: { id: "eDisposition.30", value: "transported" } } }));
  assert.deepEqual(result.groups[0], { group: "A", denominator: 5, missing: 1,
    absent: 1, invalid: 1, values: [], summary: 12.5 });
  assert.equal(result.field.unit, "min");
  assert.equal(result.population.scope, "own");
  const query = queries.find(({ sql }) => sql.includes("review_operational_time_source"));
  assert.deepEqual(query.parameters.slice(2), [session.organization.id, false, false,
    session.user.id, "eSituation.11", "eDisposition.30", "transported"]);
  assert.match(query.sql, /source.organization_id = \$3::uuid/);
  assert.match(query.sql, /interval_source.etimes_06 >= interval_source.etimes_03/);
  await assert.rejects(service.analysis("token", definition({ fieldId: "eTimes.03",
    operation: "mean" })), { status: 400 });
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
    if (sql.includes("review_custom_dictionary")) return [];
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
  const repeatedQuery = queries.find(({ sql }) => sql.includes("from analytics.review_field_source_with_identity source"));
  assert.match(repeatedQuery.sql, /source.organization_id = \$3::uuid/);
  assert.match(repeatedQuery.sql, /source.synthetic = \$4::boolean/);
  assert.match(repeatedQuery.sql, /source.documenting_user_id = \$6::uuid/);
});

test("a repeated category filter works for a wide-field measure without report fan-out", async () => {
  const queries = [];
  const service = new ReviewService({ query: async (sql) => {
    queries.push(sql);
    if (sql.includes("review_custom_dictionary")) return [];
    if (sql.includes("projection_health")) return [health];
    return [{ group_value: null, field_value: "A", absent: false, count: "2" }];
  } }, { get: async () => session });
  const result = await service.analysis("token", definition({ filters: {
    from: "2026-10-01", to: "2026-10-02", dataset: "real",
    field: { id: "eMedications.03", value: "drug-A" },
  } }));
  assert.equal(result.groups[0].denominator, 2);
  const analysisQuery = queries.find((sql) => sql.includes("from analytics.review_field_source_with_identity source"));
  assert.match(analysisQuery, /from analytics.review_field_source_with_identity source/);
  assert.match(analysisQuery, /exists \(select 1 from analytics.review_repeated_field_source f/);
});

test("Review discovers projected historical custom fields and enforces privacy and operation policy", async () => {
  const customId = "33333333-3333-4333-8333-333333333333";
  const rows = [
    { custom_definition_id: customId, title: "Dose", datatype: "number", recurrence: "single",
      identifying: false, semantic_count: "1", datatype_count: "1", recurrence_count: "1", privacy_count: "1" },
    { custom_definition_id: "44444444-4444-4444-8444-444444444444", title: "Opaque attachment",
      datatype: "binary", recurrence: "single", identifying: false,
      semantic_count: "1", datatype_count: "1", recurrence_count: "1", privacy_count: "1" },
  ];
  const queries = [];
  const service = new ReviewService({ query: async (sql, parameters) => {
    queries.push({ sql, parameters });
    if (sql.includes("review_custom_dictionary")) return rows;
    if (sql.includes("projection_health")) return [health];
    if (sql.includes("review_custom_field_source")) return [{ denominator: "4", missing: "1",
      absent: "1", mean: "2.5", median: "2.5", minimum: "2", maximum: "3" }];
    return [];
  } }, { get: async () => session });
  const fields = await service.analysisFields("token");
  assert.deepEqual(fields.find(({ id }) => id === customId)?.operations,
    ["mean", "median", "minimum", "maximum"]);
  assert.deepEqual(fields.find(({ label }) => label === "Opaque attachment")?.operations, []);
  const result = await service.analysis("token", definition({ fieldId: customId, operation: "mean" }));
  assert.equal(result.groups[0].summary, 2.5);
  assert.equal(result.groups[0].absent, 1);
  assert.match(queries.find(({ sql }) => sql.includes("review_custom_field_source")).sql,
    /report.organization_id = \$3::uuid/);
  await assert.rejects(service.analysis("token", definition({ fieldId: customId,
    operation: "distribution" })), { status: 400 });
  await assert.rejects(service.analysis("token", definition({ fieldId: customId,
    operation: "mean", groupBy: "eSituation.11" })), { status: 400 });
});

test("Review custom scalar distribution keeps exceptional and missing values separate", async () => {
  const id = "55555555-5555-4555-8555-555555555555";
  const service = new ReviewService({ query: async (sql) => {
    if (sql.includes("review_custom_dictionary")) return [{ custom_definition_id: id,
      title: "Transport mode", datatype: "string", recurrence: "single", identifying: false,
      semantic_count: "1", datatype_count: "1", recurrence_count: "1", privacy_count: "1" }];
    if (sql.includes("projection_health")) return [health];
    if (sql.includes("review_custom_field_source")) return [
      { field_value: null, absent: false, count: "2" },
      { field_value: null, absent: true, count: "1" },
      { field_value: "ground", absent: false, count: "3" },
    ];
    return [];
  } }, { get: async () => session });
  const fields = await service.analysisFields("token");
  assert.deepEqual(fields.find((field) => field.id === id)?.operations, ["distribution"]);
  const result = await service.analysis("token", definition({ fieldId: id }));
  assert.deepEqual(result.groups[0], { group: null, denominator: 6, missing: 2, absent: 1,
    summary: null, values: [{ value: "ground", count: 3, percentage: 50 }] });
});
