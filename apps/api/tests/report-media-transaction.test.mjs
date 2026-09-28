import assert from "node:assert/strict";
import test from "node:test";
import { retryMediaTransaction } from "../dist/reports/report-media-transaction.js";

for (const code of ["40001", "40P01"]) {
  test(`media transactions retry a rolled-back ${code} with a fresh transaction`, async () => {
    let attempts = 0;
    const result = await retryMediaTransaction(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("rolled back"), { code });
      return "committed";
    });
    assert.equal(result, "committed");
    assert.equal(attempts, 3);
  });
}

test("persistent contention stops after three transactions", async () => {
  let attempts = 0;
  const error = Object.assign(new Error("rolled back"), { code: "40001" });
  await assert.rejects(retryMediaTransaction(async () => { attempts += 1; throw error; }), (caught) => caught === error);
  assert.equal(attempts, 3);
});

test("constraints, authorization failures and ambiguous network outcomes are not retried", async () => {
  for (const code of ["23503", "23505", "23514", "42501", "ECONNRESET", undefined]) {
    let attempts = 0;
    const error = Object.assign(new Error("failed"), { code });
    await assert.rejects(retryMediaTransaction(async () => { attempts += 1; throw error; }), (caught) => caught === error);
    assert.equal(attempts, 1);
  }
});
