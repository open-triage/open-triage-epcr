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
