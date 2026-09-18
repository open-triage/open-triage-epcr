import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(new URL("../../../supabase/migrations/20260918170000_validation_required_element_rule.sql", import.meta.url), "utf8");
const capabilitySql = await readFile(new URL("../../../supabase/migrations/20260918183807_validation_capabilities_and_default_grants.sql", import.meta.url), "utf8");

test("Validation capabilities have explicit protected-role defaults without changing custom roles", () => {
  for (const capability of ["validation:read", "validation:write", "validation:publish"]) {
    assert.ok(capabilitySql.includes(`'${capability}'`), `missing ${capability}`);
  }
  const administrator = capabilitySql.match(/when 'administrator' then array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? "";
  const demo = capabilitySql.match(/when 'demo' then array\[([\s\S]*?)\]::text\[\]/)?.[1] ?? "";
  assert.match(administrator, /'validation:publish'/);
  assert.match(administrator, /'validation:read'/);
  assert.match(administrator, /'validation:write'/);
  assert.match(demo, /'validation:read'/);
  assert.match(demo, /'validation:write'/);
  assert.doesNotMatch(demo, /'validation:publish'/);
  assert.match(capabilitySql, /where role\.system_key in \('administrator', 'demo'\) and role\.protected/);
  assert.doesNotMatch(capabilitySql, /where role\.system_key is null/);
});

test("validation versions and rule identities are organization-scoped and published content is immutable", () => {
  assert.match(sql, /create table validation\.rule_identity/);
  assert.match(sql, /unique \(organization_id, id\)/);
  assert.match(sql, /foreign key \(organization_id, rule_id\)/);
  assert.match(sql, /published validation versions are immutable/);
  assert.match(sql, /validation_one_draft_per_organization_idx/);
});

test("reports pin a compatible published validation version without rewriting legacy reports", () => {
  assert.match(sql, /add column validation_version_id uuid/);
  assert.match(sql, /report validation version is immutable/);
  assert.match(sql, /must be published and bound to its pinned catalog/);
  assert.match(sql, /null identifies a truthful legacy report/);
});

test("finding persistence carries canonical authored-rule evidence", () => {
  for (const field of ["validation_version_id", "validation_rule_id", "execution_target", "target_element_id", "input_fingerprint"]) {
    assert.ok(sql.includes(field), `missing ${field}`);
  }
});
