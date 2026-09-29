import assert from "node:assert/strict";
import test from "node:test";
import { customTextDefinitionFindings } from "../dist/admin/custom-text-definition.js";

const valid = {
  id: "da77b0fc-a701-41b0-a387-18b07662ed71", namespace: "org.example.ems", slug: "LocalNote",
  title: "Local note", definition: "A locally requested clinical note.", datatype: "string",
  recurrence: "single", usage: "Optional", constraints: { minLength: 2, maxLength: 100 }, identifying: false,
};

test("custom text requires explicit privacy classification and valid immutable identity metadata", () => {
  assert.deepEqual(customTextDefinitionFindings(valid), []);
  assert.ok(customTextDefinitionFindings({ ...valid, identifying: null }).some((finding) => finding.includes("identifying")));
  assert.ok(customTextDefinitionFindings({ ...valid, title: 42, definition: [] }).length);
  assert.ok(customTextDefinitionFindings({ ...valid, namespace: "NEMSIS", slug: "eVitals.06" }).length);
  assert.ok(customTextDefinitionFindings({ ...valid, constraints: { minLength: 5, maxLength: 2 } }).length);
});

test("number, date/time, and boolean definitions allow only meaningful constraints", () => {
  assert.deepEqual(customTextDefinitionFindings({ ...valid, datatype: "number", constraints: { minimum: -2.5, maximum: 10 } }), []);
  assert.deepEqual(customTextDefinitionFindings({ ...valid, datatype: "dateTime", constraints: {} }), []);
  assert.deepEqual(customTextDefinitionFindings({ ...valid, datatype: "boolean", constraints: {} }), []);
  assert.match(customTextDefinitionFindings({ ...valid, datatype: "boolean", constraints: { minimum: 0 } }).join(" "), /Unsupported boolean constraint/);
  assert.match(customTextDefinitionFindings({ ...valid, datatype: "number", constraints: { minimum: 10, maximum: 2 } }).join(" "), /minimum must not exceed maximum/);
  assert.match(customTextDefinitionFindings({ ...valid, datatype: "number", constraints: { minimum: Number.NaN } }).join(" "), /finite number/);
});
