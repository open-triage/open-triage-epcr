import assert from "node:assert/strict";
import test from "node:test";
import { withReportSnapshot } from "../dist/reports/report-snapshot.js";

for (const code of ["40001", "40P01"]) {
  test(`report snapshots retry ${code} with fresh reads and commit only the successful audit`, async () => {
    let attempts = 0;
    const committed = [], reads = [];
    const database = { transaction: async (isolation, work) => {
      assert.equal(isolation, "REPEATABLE READ");
      const revision = ++attempts;
      const audit = [];
      const result = await work({ revision, audit });
      if (revision === 1) throw Object.assign(new Error("transaction rolled back"), { code });
      committed.push(...audit);
      return result;
    } };
    const result = await withReportSnapshot(database, async manager => {
      reads.push(manager.revision);
      manager.audit.push(manager.revision);
      return { revision: manager.revision };
    });
    assert.deepEqual(result, { revision: 2 });
    assert.deepEqual(reads, [1, 2]);
    assert.deepEqual(committed, [2]);
  });
}

test("report snapshots do not retry authorization, constraints or ambiguous connection failures", async () => {
  for (const code of ["42501", "23505", "ECONNRESET"]) {
    let attempts = 0;
    const failure = Object.assign(new Error("unavailable"), { code });
    const database = { transaction: async (_isolation, work) => { attempts++; return work({}); } };
    await assert.rejects(withReportSnapshot(database, async () => { throw failure; }), error => error === failure);
    assert.equal(attempts, 1);
  }
});
