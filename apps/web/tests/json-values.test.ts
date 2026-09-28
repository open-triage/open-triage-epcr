import assert from "node:assert/strict";
import test from "node:test";
import { sameJsonValue } from "../app/json-values";

test("JSON equality ignores property order and omitted optional fields but retains all clinical values", () => {
  assert.equal(sameJsonValue({ a: 1, b: [{ x: null, y: false }], optional: undefined }, { b: [{ y: false, x: null }], a: 1 }), true);
  assert.equal(sameJsonValue({ a: null }, {}), false);
  assert.equal(sameJsonValue({ a: 0 }, { a: false }), false);
  assert.equal(sameJsonValue([1, 2], [2, 1]), false);
  assert.equal(sameJsonValue([], {}), false);
  assert.equal(sameJsonValue({ document: { revision: 1 } }, { document: { revision: 2 } }), false);
});
