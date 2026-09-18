import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../../../supabase/migrations/20260918220000_enforce_validation_acknowledgements.sql", import.meta.url), "utf8");

test("finding acknowledgement persistence identifies severity, exact repeated target, and actor", () => {
  assert.match(sql, /severity in \('error', 'warning', 'information'\)/);
  for (const field of ["target_group_instance_id", "target_occurrence_id", "acknowledged_by", "input_fingerprint"]) {
    assert.ok(sql.includes(field), `missing ${field}`);
  }
});
