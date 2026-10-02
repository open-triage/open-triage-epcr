import assert from "node:assert/strict";
import test from "node:test";
import { reduceRepeated } from "../dist/review/review-repeated.js";

const definition = (operation, reducer) => ({ fieldId: "eVitals.06", operation, reducer,
  filters: { from: "2026-10-01", to: "2026-10-02", dataset: "synthetic" } });
const row = (report_id, occurrence_id, numeric_value, options = {}) => ({ report_id,
  group_value: null, occurrence_id, group_id: "test-group", group_instance_id: occurrence_id,
  parent_group_instance_id: null,
  group_ordinal: 1, element_ordinal: 1, clinical_time: null, documented_time: null,
  code: null, numeric_value, unit_code: "mm[Hg]", absence_kind: null, absence_code: null,
  normalization_rule_id: null, quality_flags: null,
  ...options });

test("repeated medication categories count each report once per category", () => {
  const rows = [row("a", "a1", null, { code: "A" }), row("a", "a2", null, { code: "A" }),
    row("a", "a3", null, { code: "B" }), row("b", "b1", null, { code: "B" }),
    row("c", null, null)];
  const result = reduceRepeated(rows, definition("distribution"), null);
  assert.deepEqual(result.groups[0].values, [
    { value: "B", count: 2, percentage: 200 / 3 },
    { value: "A", count: 1, percentage: 100 / 3 },
  ]);
  assert.equal(result.groups[0].denominator, 3);
  assert.equal(result.groups[0].missing, 1);
  assert.deepEqual(result.sources[0].value, ["A", "B"]);
  assert.equal(result.sources[0].sourceValues.length, 3);
});

test("every reducer contributes one value per report and retains source identity", () => {
  const rows = [row("a", "a1", 10, { group_ordinal: 2, clinical_time: "2026-10-01T10:00:00Z" }),
    row("a", "a2", 30, { group_ordinal: 1, clinical_time: "2026-10-01T10:00:00Z",
      quality_flags: ["outlier"] }),
    row("b", "b1", 20, { clinical_time: "2026-10-01T09:00:00Z" }),
    row("b", "b2", 40, { group_ordinal: 2, clinical_time: "2026-10-01T11:00:00Z" })];
  for (const [reducer, expected] of [["first", 25], ["last", 25],
    ["minimum", 15], ["maximum", 35]]) {
    const result = reduceRepeated(rows, definition("mean", reducer), "mm[Hg]");
    assert.equal(result.groups[0].summary, expected, reducer);
    assert.equal(result.groups[0].denominator, 2);
    assert.equal(result.sources[0].sourceValues[1].qualityFlags[0], "outlier");
    assert.equal(result.sources[0].groupInstanceIds.length, 2);
    assert.equal(result.sources[0].orderMode, "clinical-time");
  }
});

test("partial clinical timestamps use occurrence order, not a fabricated timeline", () => {
  const rows = [row("a", "a1", 10, { group_ordinal: 1, clinical_time: "2026-10-01T11:00:00Z" }),
    row("a", "a2", 30, { group_ordinal: 2 }), row("b", "b1", 20)];
  assert.equal(reduceRepeated(rows, definition("mean", "first"), "mm[Hg]").groups[0].summary, 15);
  assert.equal(reduceRepeated(rows, definition("mean", "last"), "mm[Hg]").groups[0].summary, 25);
  assert.equal(reduceRepeated(rows, definition("mean", "first"), "mm[Hg]").sources[0].orderMode,
    "occurrence-order");
});

test("dose reductions keep units and exceptional states separate", () => {
  const rows = [row("a", "a1", 5, { unit_code: "mg", quality_flags: ["outside-range"] }),
    row("a", "a2", 100, { unit_code: "mcg" }),
    row("b", "b1", 15, { unit_code: "mg" }),
    row("c", "c1", null, { unit_code: "mg", absence_kind: "not-value" })];
  const result = reduceRepeated(rows, definition("mean", "maximum"), "mg");
  assert.equal(result.groups[0].summary, 10);
  assert.equal(result.groups[0].denominator, 3);
  assert.equal(result.groups[0].absent, 1);
  assert.deepEqual(result.sources[0].sourceValues.map((value) => value.value), [5]);
  assert.deepEqual(result.sources[0].sourceValues[0].qualityFlags, ["outside-range"]);
});
