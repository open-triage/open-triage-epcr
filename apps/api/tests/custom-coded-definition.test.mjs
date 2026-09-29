import assert from "node:assert/strict";
import test from "node:test";
import { customTextDefinitionFindings } from "../dist/admin/custom-text-definition.js";
import { customCodedValueFindings } from "../dist/reports/custom-coded-validation.js";
import { validateFieldChoicePolicies } from "../dist/forms/field-choice-policy.js";

const definition = {
  id: "d474249a-f946-4b96-8280-637782b2ef13", namespace: "org.example.ems", slug: "LocalFinding",
  title: "Local finding", definition: "Agency observation code.", datatype: "coded", recurrence: "single",
  usage: "Optional", identifying: false, codeSystem: "https://example.org/ems/finding",
  choices: [{ code: "A", label: "Alert", nemsisCode: "3326001" }, { code: "B", label: "Other" }],
  nemsisElement: "eVitals.26", permittedNotValues: ["7701003"], permittedPertinentNegatives: ["8801019"],
};
const policy = [{ kind: "code", code: "A", codeSystem: definition.codeSystem }, { kind: "not-value", code: "7701003" }];

test("custom coded authoring validates identities and pinned exceptional codes", () => {
  assert.deepEqual(customTextDefinitionFindings(definition), []);
  assert.match(customTextDefinitionFindings({ ...definition, choices: [...definition.choices, definition.choices[0]] }).join(" "), /Duplicate custom code/);
  assert.match(customTextDefinitionFindings({ ...definition, permittedNotValues: ["7701999"] }).join(" "), /pinned NEMSIS/);
  assert.match(customTextDefinitionFindings({ ...definition, codeSystem: "urn:nemsis:3.5.1" }).join(" "), /custom code system/i);
});

test("form policy and clinical save reject unconfigured coded and exceptional values", () => {
  const form = { schemaVersion: 1, sections: [{ key: "one", fields: [{ key: "finding",
    source: { kind: "custom", elementDefinitionId: definition.id }, choicePolicy: policy }] }] };
  assert.deepEqual(validateFieldChoicePolicies(form, {}, { [definition.id]: definition }), []);
  assert.match(validateFieldChoicePolicies({ ...form, sections: [{ key: "one", fields: [{ ...form.sections[0].fields[0],
    choicePolicy: [{ kind: "code", code: "missing", codeSystem: definition.codeSystem }] }] }] }, {},
    { [definition.id]: definition }).join(" "), /unavailable/);
  assert.deepEqual(customCodedValueFindings(definition, { kind: "coded", code: "A", codeSystem: definition.codeSystem }, policy, ["7701003", "8801019"]), []);
  assert.match(customCodedValueFindings(definition, { kind: "coded", code: "B", codeSystem: definition.codeSystem }, policy, []).join(" "), /disabled/);
  assert.match(customCodedValueFindings(definition, { kind: "coded", code: "A", codeSystem: "urn:nemsis:3.5.1" }, policy, []).join(" "), /not a choice/);
  assert.deepEqual(customCodedValueFindings(definition, { kind: "null", absenceCode: "7701003" }, policy, ["7701003"]), []);
  assert.match(customCodedValueFindings(definition, { kind: "null", absenceCode: "7701003" }, policy, []).join(" "), /unavailable/);
  assert.deepEqual(customCodedValueFindings(definition, { kind: "pertinent-negative", absenceCode: "8801019" }, policy, ["8801019"]), []);
  assert.match(customCodedValueFindings(definition, { kind: "pertinent-negative", absenceCode: "8801019" }, policy, []).join(" "), /unavailable/);
});
