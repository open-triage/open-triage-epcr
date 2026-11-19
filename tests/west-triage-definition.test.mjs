import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const file = new URL("../defines/decision_support/west-a-2025.json", import.meta.url);
const definition = JSON.parse(readFileSync(file, "utf8"));
const tables = definition.scoreTables;

test("WEST selections belong to the vital group and the NEWS scale defaults to Standard", () => {
  const assessment = definition.assessment;
  assert.equal(assessment.group, "eVitals.VitalGroup");
  for (const field of ["categories", "criteria", "noWarningCriteria", "newsScale", "overrideColour"]) {
    assert.equal(assessment.elements[field].kind, "custom", field);
  }
  const scale = assessment.elements.newsScale;
  assert.deepEqual(Object.keys(scale.values).sort(), ["copd", "obstetric", "standard"]);
  assert.equal(scale.selectedBy, "clinician");
  assert.equal(scale.defaultValue, "standard");
  assert.equal(scale.values[scale.defaultValue].scoreName, "NEWS2");
  assert.ok(Object.values(scale.values).every(value => value.autoSelect === undefined));
  assert.ok(assessment.carryFromPrecedingMeasurement.includes("newsScale"));
});

function scoresAt(table, value) {
  return table.bands
    .filter(({ minInclusive, maxInclusive }) =>
      (minInclusive === null || value >= minInclusive) &&
      (maxInclusive === null || value <= maxInclusive))
    .map(({ points }) => points);
}

test("the Vitals score is one read-only numeric catalog element for the active NEWS scale", () => {
  const score = definition.assessment.elements.physiologyScore;
  assert.equal(score.kind, "calculated");
  assert.equal(score.catalog, "custom");
  assert.equal(score.type, "integer");
  assert.equal(score.scaleElement, "newsScale");
  assert.equal(score.readOnly, true);
  assert.equal(score.visibleWhen, "allScaleComponentsScored");
  assert.ok(definition.assessment.result.numericTotalRequiresEveryComponent);
});

test("each permitted observation has exactly one score on each applicable NEWS scale", () => {
  for (const scale of Object.values(definition.assessment.elements.newsScale.values)) {
    for (const [key, tableName] of Object.entries(scale.tablesByInput)) {
      const input = definition.inputs[key];
      const table = tables[tableName];
      if (table.pointsByValue) {
        for (const value of input.values) {
          assert.ok(Number.isInteger(table.pointsByValue[value]), tableName + " " + value);
        }
        continue;
      }
      const branches = table.branchOn
        ? definition.inputs[table.branchOn].values.map(value => table.branches[value])
        : [table];
      const factor = 10 ** input.precision;
      for (const branch of branches) {
        for (let i = input.minValue * factor; i <= input.maxValue * factor; i++) {
          const points = scoresAt(branch, i / factor);
          assert.equal(points.length, 1, tableName + " at " + i / factor);
          assert.ok(Number.isInteger(points[0]) && points[0] >= 0 && points[0] <= 3);
        }
      }
    }
  }
});

test("the four overlapping ONEWS2 source endpoints follow the 2025 obstetric chart", () => {
  for (const [name, endpoint, expected] of [
    ["obRespirations", 10, [3, 0, 0]],
    ["obSystolic", 80, [3, 2, 2]],
    ["obDiastolic", 90, [0, 1, 1]],
    ["obPulse", 60, [3, 0, 0]],
  ]) {
    const scores = [-1, 0, 1].map(offset => scoresAt(tables[name], endpoint + offset));
    assert.deepEqual(scores, expected.map(score => [score]), name);
  }
});

function criteria(categories) {
  return categories.flatMap(category => [
    ...category.criteria,
    ...criteria(category.subcategories ?? []),
  ]);
}

test("equivalent selectable adult findings agree on urgency across categories", () => {
  const rows = criteria(definition.categories);
  const byText = new Map();
  for (const row of rows) {
    if (row.population === "paediatric" || row.navigateToCategory) continue;
    const text = row.text.normalize("NFC").trim().toLowerCase();
    if (byText.has(text)) {
      assert.equal(row.triage_color, byText.get(text), row.id);
    }
    byText.set(text, row.triage_color);
  }
  const byId = new Map(rows.map(row => [row.id, row]));
  assert.equal(byId.get("gynaecology.03.04").sourceTriageColour, "yellow");
  assert.equal(byId.get("gynaecology.03.04").triage_color, "orange");
  assert.equal(byId.get("bleeding.07").triage_color, "orange");
  assert.equal(byId.get("pregnancy-postpartum.01").triage_color, "red");
});
