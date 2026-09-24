import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migration = await readFile(path.resolve(import.meta.dirname,
  "../../../supabase/migrations/20260923120000_grant_portable_pgcrypto_digest_access.sql"), "utf8");
const restrictedMigration = await readFile(path.resolve(import.meta.dirname,
  "../../../supabase/migrations/20260924130000_restrict_pgcrypto_function_access.sql"), "utf8");

test("portable pgcrypto access is limited to hashing workloads and digest overloads", () => {
  assert.match(migration, /grant usage on schema %I to %I/);
  assert.match(migration, /grant execute on function %I\.digest\(bytea, text\) to %I/);
  assert.match(migration, /grant execute on function %I\.digest\(text, text\) to %I/);
  assert.match(migration, /open_triage_api_runtime/);
  assert.match(migration, /open_triage_retention_executor/);
  assert.doesNotMatch(migration, /grant usage on schema %I to public/i);
});

test("pgcrypto defaults are reduced to the extension calls used at runtime", () => {
  assert.match(restrictedMigration, /join pg_extension extension/);
  assert.match(restrictedMigration, /dependency\.deptype = 'e'/);
  assert.match(restrictedMigration, /extension_function\.owner_oid =/);
  assert.match(restrictedMigration, /revoke all on function %s from public/);
  assert.match(restrictedMigration, /platform-owned pgcrypto function % still grants EXECUTE to PUBLIC/);
  assert.match(restrictedMigration, /grant execute on function %I\.digest\(bytea, text\) to %I/);
  assert.match(restrictedMigration, /grant execute on function %I\.digest\(text, text\) to %I/);
  assert.doesNotMatch(restrictedMigration, /grant execute on all functions/i);
});
