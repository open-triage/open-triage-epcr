import assert from "node:assert/strict";
import test from "node:test";
import { reduceCustom } from "../dist/review/review-custom.js";

const numericField = { id: "dose", label: "Dose", source: "custom", kind: "numeric",
  repeating: true, unit: null, operations: ["mean", "median", "minimum", "maximum"] };
const categoryField = { id: "route", label: "Route", source: "custom", kind: "categorical",
  repeating: true, unit: null, operations: ["distribution"] };
const reports = ["r1", "r2", "r3"].map((report_id) => ({ report_id, standard_group_value: null }));
const definition = (overrides = {}) => ({ fieldId: "dose", operation: "mean", reducer: "first",
  filters: { from: "2026-10-01", to: "2026-10-02", dataset: "real" }, ...overrides });
function row(report_id, occurrence_id, custom_definition_id, parent, group, value, extras = {}) {
  return { report_id, occurrence_id, custom_definition_id, group_id: "CustomGroup",
    group_instance_id: group, parent_group_instance_id: parent,
    instance_path: ["root", parent, group], group_path: ["Root", "Parent", "CustomGroup"],
    group_ordinal: 1, element_ordinal: 1, clinical_time: null, documented_time: null,
    code: custom_definition_id === "route" ? value : null,
    categorical_value: custom_definition_id === "route" ? value : null,
    numeric_value: custom_definition_id === "dose" ? value : null,
    unit_code: null, absence_kind: null, absence_code: null,
    normalization_rule_id: null, quality_flags: null,
    element_identity_id: custom_definition_id, catalog_release_id: "release-1",
    effective_amendment_sequence: 2, correlation_id: `corr-${parent}`,
    group_correlation_id: `group-${parent}`, ...extras };
}

test("grouped custom filter keeps the matching parent entry and one count per report", () => {
  const rows = [
    row("r1", "dose-1", "dose", "med-1", "custom-1", 10),
    row("r1", "dose-2", "dose", "med-2", "custom-2", 90),
    row("r1", "route-1", "route", "med-1", "custom-1", "A"),
    row("r1", "route-2", "route", "med-2", "custom-2", "B"),
    row("r2", "dose-3", "dose", "med-3", "custom-3", 20),
    row("r2", "route-3", "route", "med-3", "custom-3", "A"),
    row("r3", "route-4", "route", "med-4", "custom-4", "A"),
  ];
  const result = reduceCustom(reports, rows, definition({ filters: {
    from: "2026-10-01", to: "2026-10-02", dataset: "real",
    field: { id: "route", value: "A" } } }), numericField, undefined, categoryField);
  assert.deepEqual(result.groups.map(({ denominator, missing, absent, summary }) =>
    ({ denominator, missing, absent, summary })),
  [{ denominator: 3, missing: 1, absent: 0, summary: 15 }]);
  assert.deepEqual(result.sources.find((source) => source.reportId === "r1")?.occurrenceIds, ["dose-1"]);
  assert.equal(result.sources.find((source) => source.reportId === "r1")?.sourceValues[0].parentGroupInstanceId,
    "med-1");
  assert.equal(result.sources.find((source) => source.reportId === "r1")?.sourceValues[0].effectiveAmendmentSequence,
    2);
});

test("grouping by repeated custom category counts a report once in each genuine category", () => {
  const rows = [
    row("r1", "dose-1", "dose", "med-1", "custom-1", 10),
    row("r1", "dose-2", "dose", "med-2", "custom-2", 90),
    row("r1", "route-1", "route", "med-1", "custom-1", "A"),
    row("r1", "route-2", "route", "med-2", "custom-2", "B"),
    row("r2", "dose-3", "dose", "med-3", "custom-3", 20),
    row("r2", "route-3", "route", "med-3", "custom-3", "A"),
  ];
  const result = reduceCustom(reports.slice(0, 2), rows,
    definition({ groupBy: "route" }), numericField, categoryField);
  assert.deepEqual(result.groups.map(({ group, denominator, summary }) =>
    ({ group, denominator, summary })), [
    { group: "A", denominator: 2, summary: 15 },
    { group: "B", denominator: 1, summary: 90 },
  ]);
});

test("custom categorical values deduplicate within reports and retain exceptional rows", () => {
  const rows = [
    row("r1", "route-1", "route", "med-1", "custom-1", "A"),
    row("r1", "route-2", "route", "med-2", "custom-2", "A"),
    row("r2", "route-3", "route", "med-3", "custom-3", "A"),
    row("r3", "route-4", "route", "med-4", "custom-4", null,
      { absence_kind: "pertinent-negative", absence_code: "refused" }),
  ];
  const result = reduceCustom(reports, rows,
    definition({ fieldId: "route", operation: "distribution", reducer: undefined }), categoryField);
  assert.deepEqual(result.groups[0], { group: null, denominator: 3, missing: 0, absent: 1,
    values: [{ value: "A", count: 2, percentage: 200 / 3 }], summary: null });
  assert.equal(result.sources.find((source) => source.reportId === "r3")?.sourceValues[0].absenceCode,
    "refused");
});
