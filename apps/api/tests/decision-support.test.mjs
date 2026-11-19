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

test("evaluates shared adult WEST findings against measurement-local window boundaries", async () => {
  const {
    calculateDecisionSupportFindings, decisionSupportCategoryCriteria, decisionSupportFindingResult,
    decisionSupportMeasurementLocalTime, decisionSupportPickerCategories,
  } = await import("@open-triage/contracts");
  const categories = decisionSupportPickerCategories(definition.categories);
  const timed = "gynaecology.01.08";
  const criteria = decisionSupportCategoryCriteria(categories.find(({ id }) => id === "gynaecology.01"));
  assert.equal(criteria.find(({ criterion }) => criterion.id === timed).criterion.time_window, "07-16");
  for (const [instant, available] of [
    ["2026-10-20T04:59:59Z", false], ["2026-10-20T05:00:00Z", true],
    ["2026-10-20T13:59:59Z", true], ["2026-10-20T14:00:00Z", false],
  ]) {
    const localTime = decisionSupportMeasurementLocalTime(instant, 120);
    const result = decisionSupportFindingResult(definition, { criteria: [timed], noWarningCriteria: false }, localTime);
    assert.equal(result.valid, true);
    assert.equal(result.highest?.criterion.id, available ? timed : undefined);
    assert.deepEqual(calculateDecisionSupportFindings(definition, result), { status: "unassessed", colour: null });
  }

  const result = (criteria, noWarningCriteria = false) =>
    decisionSupportFindingResult(definition, { criteria, noWarningCriteria }, "08:00");
  for (const code of ["bleeding.07", "gynaecology.03.04"]) {
    assert.deepEqual(calculateDecisionSupportFindings(definition, result([code])), {
      status: "provisional", colour: "orange", criterionCode: code,
    });
  }
  assert.deepEqual(calculateDecisionSupportFindings(definition, result(["bleeding.07", "pregnancy-postpartum.01"])), {
    status: "definitive", colour: "red", criterionCode: "pregnancy-postpartum.01",
  });
  assert.deepEqual(calculateDecisionSupportFindings(definition, result(["bleeding.03"])), {
    status: "provisional", colour: "yellow", criterionCode: "bleeding.03",
  });
  const alternate = structuredClone(definition);
  alternate.assessment.result.redIsDefinitiveWithIncompleteInputs = false;
  assert.equal(calculateDecisionSupportFindings(alternate, result(["pregnancy-postpartum.01"])).status, "provisional");
  assert.equal(result([]).explicitNoWarningCriteria, false);
  assert.equal(result([], true).explicitNoWarningCriteria, true);
  assert.equal(result(["infection.none", "bleeding.none"]).explicitNoWarningCriteria, true);
  assert.equal(result(["bleeding.none", "bleeding.07"]).valid, false);
  assert.equal(result(["bleeding.07"], true).valid, false);
  assert.equal(result(["trauma-alert.01.03"]).valid, false);
  assert.equal(result(["gynaecology.04.01"]).valid, false);
});
