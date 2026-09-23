import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migration = await readFile(path.resolve(import.meta.dirname,
  "../../../supabase/migrations/20260923120000_grant_portable_pgcrypto_digest_access.sql"), "utf8");

test("portable pgcrypto access is limited to hashing workloads and digest overloads", () => {
  assert.match(migration, /grant usage on schema %I to %I/);
  assert.match(migration, /grant execute on function %I\.digest\(bytea, text\) to %I/);
  assert.match(migration, /grant execute on function %I\.digest\(text, text\) to %I/);
  assert.match(migration, /open_triage_api_runtime/);
  assert.match(migration, /open_triage_retention_executor/);
  assert.doesNotMatch(migration, /grant usage on schema %I to public/i);
});
