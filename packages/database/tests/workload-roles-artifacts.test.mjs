import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [sql, offlineGrant] = await Promise.all([
  readFile(new URL(
    "../../../supabase/migrations/20260917090000_workload_database_roles.sql",
    import.meta.url
  ), "utf8"),
  readFile(new URL(
    "../../../supabase/migrations/20260918142741_grant_offline_runtime_to_api_role.sql",
    import.meta.url
  ), "utf8"),
]);

test("declares one least-privilege contract for every database workload", () => {
  for (const role of [
    "open_triage_api_runtime",
    "open_triage_migration_executor",
    "open_triage_analytics_projector",
    "open_triage_analytics_health",
    "open_triage_retention",
    "open_triage_operational_audit_writer"
  ]) assert.match(sql, new RegExp(role));

  assert.match(sql, /revoke create on database/);
  assert.match(sql, /revoke create on schema public/);
  const apiContract = sql.slice(
    sql.indexOf("grant usage on schema app_identity"),
    sql.indexOf("-- The projector")
  );
  assert.doesNotMatch(apiContract, /analytics_private|operations/);
  assert.match(sql, /grant select on operations\.projection_health to open_triage_analytics_health/);
  assert.doesNotMatch(sql, /grant select on all tables in schema operations to open_triage_analytics_health/);
  assert.match(sql, /revoke all on schema clinical, forms, catalog, app_identity\s+from open_triage_projector/);
  assert.doesNotMatch(sql, /grant usage on schema[^;]*app_identity[^;]*to open_triage_projector/);
});

test("the isolated API login inherits only the protected offline function contract", () => {
  assert.match(offlineGrant, /grant open_triage_offline_runtime to open_triage_api_runtime/);
  assert.doesNotMatch(offlineGrant, /grant (?:all|select|insert|update|delete)|alter role|superuser/i);
});
