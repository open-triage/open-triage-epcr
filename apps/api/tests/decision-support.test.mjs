import assert from "node:assert/strict";
import test from "node:test";
import definition from "../../../defines/decision_support/west-a-2025.json" with { type: "json" };
import { validateDecisionSupportDefinition } from "../dist/forms/decision-support-definition.js";
import { decisionSupportCatalogFields } from "../dist/forms/decision-support.js";

test("validates the complete shipped WEST artifact and its provenance", () => {
  assert.equal(validateDecisionSupportDefinition(definition), definition);
  assert.equal(definition.conflicts.length, 14);
});

const invalidCases = [
  ["score gap", (copy) => { copy.scoreTables.temperature.bands[2].minInclusive = 36.2; }, /score gap at 36\.1/],
  ["score overlap", (copy) => { copy.scoreTables.obPulse.bands[1].minInclusive = 59; }, /overlapping bands at 59/],
  ["missing oxygen branch", (copy) => { delete copy.scoreTables.saturation2.branches.air; }, /every branch value/],
  ["invalid score", (copy) => { copy.scoreTables.oxygen.pointsByValue.air = 4; }, /valid score per code/],
  ["unknown table", (copy) => { copy.assessment.elements.newsScale.values.standard.tablesByInput.spo2 = "absent"; }, /Unknown input or table/],
  ["unknown default scale", (copy) => { copy.assessment.elements.newsScale.defaultValue = "absent"; }, /Unknown default/],
  ["unknown category", (copy) => { copy.categories.find((category) => category.id === "gynaecology").subcategories[3]
    .criteria[0].navigateToCategory = "absent"; }, /Unknown category absent/],
  ["unknown window", (copy) => { copy.categories[0].criteria[0].time_window = "absent"; }, /Unknown measurement-time window/],
  ["category-dependent negative code collision", (copy) => { copy.categories[0].criteria[0].id = "allergy.none"; }, /duplicate criterion allergy.none/],
];
for (const [name, mutate, message] of invalidCases) test(`rejects ${name}`, () => {
  const copy = structuredClone(definition);
  mutate(copy);
  assert.throws(() => validateDecisionSupportDefinition(copy), message);
});

test("catalog codes match the adult picker and field identities survive new versions", () => {
  const organizationId = "36f82a8d-2c39-45b3-92b7-52e45367a0f2";
  const fields = decisionSupportCatalogFields(definition, organizationId);
  const reloaded = decisionSupportCatalogFields({ ...definition, version: "new-version" }, organizationId);
  assert.deepEqual(reloaded, fields);
  assert.notEqual(decisionSupportCatalogFields(definition, "another-agency").criteria.id, fields.criteria.id);
  assert.ok(Object.values(fields).every((field) => field.correlatesTo === "eVitals.VitalGroup"));
  assert.ok(fields.physiologyScore.readOnly);
  assert.ok(fields.physiologyScore.integer);
  assert.equal(fields.noWarningCriteria.datatype, "boolean");
  assert.deepEqual(fields.newsScale.choices.map(({ code }) => code), ["standard", "obstetric", "copd"]);
  const categories = fields.categories.choices.map(({ code }) => code);
  const criteria = fields.criteria.choices.map(({ code }) => code);
  assert.ok(categories.includes("trauma-injuries"));
  assert.ok(!categories.includes("trauma-alert"));
  assert.ok(categories.every((code) => criteria.includes(`${code}.none`)));
  assert.ok(criteria.includes("trauma-alert.01.01"));
  assert.ok(!criteria.includes("trauma-alert.01.03"));
  assert.ok(!criteria.includes("gynaecology.04.01"));
});
