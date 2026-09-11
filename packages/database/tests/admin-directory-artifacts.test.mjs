import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const migration = await readFile(path.join(repoRoot,
  "supabase/migrations/20260911190000_admin_user_search_indexes.sql"), "utf8");
const service = await readFile(path.join(repoRoot,
  "apps/api/src/admin/user-role-read.service.ts"), "utf8");

test("10,000-user discovery has indexed search and stable bounded keyset pagination", () => {
  assert.match(migration, /create extension if not exists pg_trgm/);
  assert.match(migration, /using gin \(lower\(display_name\) gin_trgm_ops\)/);
  assert.match(migration, /using gin \(username gin_trgm_ops\)/);
  assert.match(migration, /organization_id, \(not active\), lower\(display_name\), id/);
  assert.match(service, /MAX_PAGE_SIZE = 100/);
  assert.match(service, /\(not u\.active, lower\(u\.display_name\), u\.id\) >/);
  assert.match(service, /order by not u\.active, lower\(u\.display_name\), u\.id/);
  assert.doesNotMatch(service, /\boffset\b/i);
});
