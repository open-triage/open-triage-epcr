import assert from "node:assert/strict";
import test from "node:test";
import { changedReviewInputs, reviewInputLineage } from "../dist/review/review-lineage.js";

const rule = { primaryTarget: { elementId: "eVitals.06" }, references: { elementIds: ["eVitals.06"], codes: [] },
  scope: { groupId: "eVitalsSection", iteration: "each" } };
const value = (occurrenceId, value = 90) => ({ occurrenceId, kind: "scalar", value });
const document = (values, other = "unrelated", secondGroup = false) => ({ groups: [
  { id: "eVitalsSection", instances: [
    { instanceId: "row-a", elements: [
      { id: "eVitals.06", values }, { id: "eOther.01", values: [value("other", other)] },
    ] },
    ...(secondGroup ? [{ instanceId: "row-b", elements: [] }] : []),
  ] },
] });
const lineage = (source) => reviewInputLineage(source, rule, new Set());

test("unscoped group-count lineage detects empty group membership without timestamp changes", () => {
  const groupRule = { primaryTarget: { elementId: "eVitals.01" },
    references: { elementIds: [], groupIds: ["eVitals.VitalGroup"], codes: [] } };
  const input = (instances) => ({ groups: [{ id: "eVitals.VitalGroup", instances }] });
  const read = (instances) => reviewInputLineage(input(instances), groupRule, new Set());
  const empty = { instanceId: "vital-a", elements: [] };
  const lines = read([empty]);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].elementId, null);
  assert.deepEqual(changedReviewInputs(read([]), lines).map(({ change }) => change), ["added"]);
  assert.deepEqual(changedReviewInputs(lines, read([])).map(({ change }) => change), ["removed"]);
  assert.deepEqual(changedReviewInputs(lines, read([{ ...empty, elements: [
    { id: "eVitals.01", values: [value("timestamp", "2026-10-03T10:00:00Z")] },
  ] }])), []);
});

test("criterion lineage detects add, replace, remove, absence and scoped group membership", () => {
  const original = lineage(document([value("pulse-a")]));
  assert.deepEqual(changedReviewInputs(original, lineage(document([value("pulse-a")], "updated"))), []);
  assert.deepEqual(changedReviewInputs(original, lineage(document([value("pulse-a", 91)])))
    .map(({ change, occurrenceId }) => [change, occurrenceId]), [["changed", "pulse-a"]]);
  assert.deepEqual(changedReviewInputs(original, lineage(document([value("pulse-a"), value("pulse-b")])))
    .map(({ change, occurrenceId }) => [change, occurrenceId]), [["added", "pulse-b"]]);
  assert.deepEqual(changedReviewInputs(original, lineage(document([])))
    .map(({ change, occurrenceId }) => [change, occurrenceId]),
  [["added", null], ["removed", "pulse-a"]]);
  assert.deepEqual(changedReviewInputs(original, lineage(document([{
    occurrenceId: "pulse-a", kind: "null", notValue: { code: "not-known" },
  }]))).map(({ change }) => change), ["changed"]);
  assert.deepEqual(changedReviewInputs(original, lineage(document([value("pulse-a")], "unrelated", true)))
    .map(({ change, elementId }) => [change, elementId]), [["added", null]]);
});
