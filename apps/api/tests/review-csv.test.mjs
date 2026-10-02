import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ReviewController } from "../dist/review/review.controller.js";
import { ReviewService } from "../dist/review/review.service.js";
import { aggregateRevision, analysisCsv } from "../dist/review/review-csv.js";

const freshness = { observedAt: "2026-10-02T10:00:00.000Z", targetSeconds: 300,
  status: "current", oldestBacklogSeconds: null, replicaLagSeconds: null };
const population = { unit: "patient-report", scope: "all",
  organizationId: "11111111-1111-4111-8111-111111111111", signedOnly: true };
const filters = { from: "2026-10-01", to: "2026-10-02", dataset: "real" };
const distribution = { definition: { fieldId: "eSituation.09", operation: "distribution", filters },
  field: { id: "eSituation.09", label: "User \"symptom\"\nline", kind: "categorical",
    unit: null, operations: ["distribution"] }, population, freshness,
  groups: [{ group: "=HYPERLINK(\"bad\")", denominator: 4, missing: 1, absent: 1,
    values: [{ value: "  +SUM(1,2)\nnext", count: 2, percentage: 50 }], summary: null }] };
const numeric = { definition: { fieldId: "review.duration.response", operation: "mean",
  groupBy: "eSituation.11", filters: { ...filters, field: { id: "eSituation.11", value: "@test" } } },
  field: { id: "review.duration.response", label: "Response time", kind: "numeric", unit: "min",
    operations: ["mean", "median", "minimum", "maximum"],
    interval: { start: "eTimes.03", end: "eTimes.06", eligibility: "signed-patient-reports" } },
  population, freshness, groups: [{ group: "A", denominator: 5, missing: 1,
    absent: 1, invalid: 1, values: [], summary: 12.5 }] };
const volume = { definition: { measure: "signed-report-count", grouping: "day", filters },
  population, freshness, total: 3,
  points: [{ date: "2026-10-01", count: 2 }, { date: "2026-10-02", count: 1 }] };

function response() {
  const headers = {};
  return { headers, body: null, setHeader(name, value) { headers[name.toLowerCase()] = value; },
    send(value) { this.body = value; return value; } };
}

function parseCsv(content) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (quoted) {
      if (character === '"' && content[index + 1] === '"') { value += '"'; index++; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\r" && content[index + 1] === "\n") {
      row.push(value); rows.push(row); row = []; value = ""; index++;
    } else value += character;
  }
  assert.equal(quoted, false);
  return rows;
}

test("aggregate CSV exports the displayed distribution and hostile cells safely", async () => {
  let current = distribution;
  const controller = new ReviewController({ analysis: async () => current });
  const shown = await controller.analysis(distribution.definition, "Bearer token");
  const sent = response();
  await controller.exportAnalysis({ definition: shown.definition,
    expectedRevision: shown.exportRevision }, "Bearer token", undefined, sent);
  assert.equal(sent.headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(Number(sent.headers["content-length"]), Buffer.byteLength(sent.body));
  const rows = parseCsv(sent.body);
  assert.deepEqual(rows.find((row) => row[0] === "dataset"), ["dataset", "real"]);
  assert.deepEqual(rows.find((row) => row[0] === "measure"), ["measure", "eSituation.09"]);
  assert.deepEqual(rows.find((row) => row[0] === "freshness_status"), ["freshness_status", "current"]);
  assert.deepEqual(rows.find((row) => row[0] === "measure_label"),
    ["measure_label", "User \"symptom\"\nline"]);
  assert.deepEqual(rows.at(-1), ["'=HYPERLINK(\"bad\")", "false", "4", "1", "1", "",
    "'  +SUM(1,2)\nnext", "2", "50", "", ""]);
  current = { ...distribution, groups: [{ ...distribution.groups[0], denominator: 5 }] };
  await assert.rejects(controller.exportAnalysis({ definition: shown.definition,
    expectedRevision: shown.exportRevision }, "Bearer token", undefined, response()), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.response.result.groups[0].denominator, 5);
    assert.notEqual(error.response.result.exportRevision, shown.exportRevision);
    return true;
  });
});

test("numeric and volume CSV include exact displayed values and context", async () => {
  const controller = new ReviewController({ analysis: async () => numeric, volume: async () => volume });
  const analysisShown = await controller.analysis(numeric.definition, "Bearer token");
  const numericResponse = response();
  await controller.exportAnalysis({ definition: numeric.definition,
    expectedRevision: analysisShown.exportRevision }, "Bearer token", undefined, numericResponse);
  const numericRows = parseCsv(numericResponse.body);
  assert.deepEqual(numericRows.find((row) => row[0] === "filter_value"), ["filter_value", "'@test"]);
  assert.deepEqual(numericRows.find((row) => row[0] === "interval_start"), ["interval_start", "eTimes.03"]);
  assert.deepEqual(numericRows.at(-1), ["A", "false", "5", "1", "1", "1", "", "", "", "12.5", "min"]);
  const volumeShown = await controller.volume("real", filters.from, filters.to, "Bearer token");
  const volumeResponse = response();
  await controller.exportVolume({ definition: volume.definition,
    expectedRevision: volumeShown.exportRevision }, "Bearer token", undefined, volumeResponse);
  const volumeRows = parseCsv(volumeResponse.body);
  assert.deepEqual(volumeRows.find((row) => row[0] === "total"), ["total", "3"]);
  assert.deepEqual(volumeRows.slice(-2), [["2026-10-01", "2"], ["2026-10-02", "1"]]);
});

test("export rechecks access, rejects foreign revisions and unsupported definitions", async () => {
  let access = true; let current = distribution;
  const controller = new ReviewController({ analysis: async () => {
    if (!access) throw new ForbiddenException();
    return current;
  }, volume: async () => volume });
  const revision = aggregateRevision(distribution);
  current = { ...distribution, population: { ...population,
    organizationId: "22222222-2222-4222-8222-222222222222" } };
  await assert.rejects(controller.exportAnalysis({ definition: distribution.definition,
    expectedRevision: revision }, "Bearer token", undefined, response()), { status: 409 });
  access = false;
  await assert.rejects(controller.exportAnalysis({ definition: distribution.definition,
    expectedRevision: revision }, "Bearer token", undefined, response()), { status: 403 });
  await assert.rejects(controller.exportAnalysis({ definition: distribution.definition,
    expectedRevision: "invalid" }, "Bearer token", undefined, response()),
  BadRequestException);
  await assert.rejects(controller.exportVolume({ definition: { ...volume.definition,
    measure: "unrestricted" }, expectedRevision: aggregateRevision(volume) },
  "Bearer token", undefined, response()), BadRequestException);
});

test("CSV serializes every completed aggregate row without truncation", () => {
  const values = Array.from({ length: 500 }, (_, index) => ({ value: `code-${index}`,
    count: 1, percentage: 0.2 }));
  const result = { ...distribution, groups: [{ ...distribution.groups[0],
    denominator: 500, missing: 0, absent: 0, values }] };
  const rows = parseCsv(analysisCsv(result));
  assert.equal(rows.filter((row) => row[0] === "'=HYPERLINK(\"bad\")").length, 500);
  assert.deepEqual(rows.at(-1).slice(6, 9), ["code-499", "1", "0.2"]);
});

test("grouped custom aggregates export every group, reducer, filter, and unit context", async () => {
  const result = { ...numeric,
    definition: { ...numeric.definition, fieldId: "33333333-3333-4333-8333-333333333333",
      groupBy: "44444444-4444-4444-8444-444444444444", reducer: "first", unit: "mg",
      filters: { ...filters, field: { id: "55555555-5555-4555-8555-555555555555", value: "=IV" } } },
    field: { id: "33333333-3333-4333-8333-333333333333", label: "Dose", source: "custom",
      kind: "numeric", unit: "mg", repeating: true,
      operations: ["mean", "median", "minimum", "maximum"] },
    groups: [{ group: "=Night", denominator: 3, missing: 1, absent: 0,
      values: [], summary: 2.5 }, { group: "Day", denominator: 2, missing: 0,
      absent: 1, values: [], summary: 5 }],
    sources: [{ reportId: "r1", group: "=Night", value: 2.5, unit: "mg",
      occurrenceIds: ["o1"], groupInstanceIds: ["g1"], sourceValues: [] }] };
  const controller = new ReviewController({ analysis: async () => result });
  const shown = await controller.analysis(result.definition, "Bearer token");
  const sent = response();
  await controller.exportAnalysis({ definition: result.definition,
    expectedRevision: shown.exportRevision }, "Bearer token", undefined, sent);
  const rows = parseCsv(sent.body);
  assert.deepEqual(rows.find((row) => row[0] === "group_by"),
    ["group_by", "44444444-4444-4444-8444-444444444444"]);
  assert.deepEqual(rows.find((row) => row[0] === "reducer"), ["reducer", "first"]);
  assert.deepEqual(rows.find((row) => row[0] === "filter_value"), ["filter_value", "'=IV"]);
  assert.deepEqual(rows.slice(-2).map((row) => [row[0], row[2], row[9], row[10]]),
    [["'=Night", "3", "2.5", "mg"], ["Day", "2", "5", "mg"]]);
  assert.equal(sent.body.includes("r1"), false, "Aggregate CSV must omit underlying report identities");
});

test("export re-runs field discovery after identifying and report capability revocation", async () => {
  const id = "33333333-3333-4333-8333-333333333333";
  let capabilities = ["review:all", "review:identifying"];
  const custom = { custom_definition_id: id, title: "Sensitive score", datatype: "number",
    recurrence: "single", identifying: true, semantic_count: "1", datatype_count: "1",
    recurrence_count: "1", privacy_count: "1" };
  const database = { query: async (sql, parameters) => {
    if (sql.includes("review_custom_dictionary")) return parameters[1] ? [custom] : [];
    if (sql.includes("projection_health")) return [{ observed_at: freshness.observedAt,
      oldest_backlog_age_seconds: null, persistent_failure_count: 0, retrying_count: 0,
      stale_run_count: 0, last_run_status: "succeeded", is_read_only_replica: false,
      replay_lag_seconds: null }];
    if (sql.includes("review_custom_field_source")) return [{ denominator: "1", missing: "0",
      absent: "0", mean: "7", median: "7", minimum: "7", maximum: "7" }];
    return [];
  } };
  const sessions = { get: async () => ({ user: { id: "22222222-2222-4222-8222-222222222222" },
    organization: { id: population.organizationId }, capabilities }) };
  const controller = new ReviewController(new ReviewService(database, sessions));
  const definition = { fieldId: id, operation: "mean", filters };
  const shown = await controller.analysis(definition, "Bearer token");
  capabilities = ["review:all"];
  await assert.rejects(controller.exportAnalysis({ definition, expectedRevision: shown.exportRevision },
    "Bearer token", undefined, response()), { status: 400 });
  capabilities = [];
  await assert.rejects(controller.exportAnalysis({ definition, expectedRevision: shown.exportRevision },
    "Bearer token", undefined, response()), { status: 403 });
});
