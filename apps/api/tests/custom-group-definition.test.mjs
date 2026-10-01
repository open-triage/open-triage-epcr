import assert from "node:assert/strict";
import test from "node:test";
import { customGroupDefinitionFindings } from "../dist/admin/custom-group-definition.js";

const valid = { id: "f064177e-d9aa-487e-b9d3-ad581e117b87", namespace: "org.example.ems",
  slug: "MedicationResponse", title: "Medication response", recurrence: "multiple",
  correlatesTo: "eMedications.MedicationGroup" };

test("flat custom groups require an explicit recurrence and a nonempty correlation", () => {
  assert.deepEqual(customGroupDefinitionFindings(valid), []);
  assert.deepEqual(customGroupDefinitionFindings({ ...valid, recurrence: "nested", correlatesTo: "" }), [
    "Custom group recurrence must be single or multiple", "Custom group correlation target is invalid",
  ]);
  assert.deepEqual(customGroupDefinitionFindings({ ...valid, correlatesTo: "eVitals.VitalGroup" }), []);
  assert.match(customGroupDefinitionFindings({ ...valid, id: "not-an-id" }).join("; "), /version-4 UUID/);
});

test("a Swedish group label must be reviewed against its current source title", () => {
  assert.deepEqual(customGroupDefinitionFindings({ ...valid, localization: { schemaVersion: 1,
    sv: { label: "Läkemedelssvar", reviewedSource: { label: valid.title } } } }), []);
  assert.match(customGroupDefinitionFindings({ ...valid, localization: { schemaVersion: 1,
    sv: { label: "Läkemedelssvar", reviewedSource: { label: "Old title" } } } }).join("; "), /current English title/);
});
