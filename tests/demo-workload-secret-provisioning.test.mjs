import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL(
  "../scripts/provision-demo-workload-secrets.sh",
  import.meta.url,
), "utf8");

test("the demo transition preserves keys and creates separate workload Secrets", () => {
  for (const key of [
    "SUPABASE_URL", "SUPABASE_SECRET_KEY", "PATIENT_KEY_INSTALLATION_ID",
    "PATIENT_KEY_VERSION", "PATIENT_KEY_SECRET_BASE64",
    "AUTH_RATE_LIMIT_SECRET_BASE64", "OFFLINE_RECOVERY_KEY_VERSION",
    "OFFLINE_RECOVERY_SECRET_BASE64",
  ]) assert.match(script, new RegExp(`secret_value \\\"?\\$legacy_secret\\\"? ${key}|secret_value "\\$legacy_secret" ${key}`));

  for (const secret of [
    "open-triage-api-database", "open-triage-migration-database",
    "open-triage-analytics-projector-database", "open-triage-analytics-health-database",
    "open-triage-retention-database", "open-triage-operational-audit-database",
  ]) assert.ok(script.includes(secret));
  assert.match(script, /Refusing to overwrite a partial credential transition/);
  assert.match(script, /normalize_workload_secret/);
  assert.match(script, /kubectl patch secret/);
  assert.doesNotMatch(script, /migrate:runtime|name: migration|credential-migration/);
});

test("the transition does not print or trace credential values", () => {
  assert.match(script, /set -euo pipefail/);
  assert.doesNotMatch(script, /set -x|printenv|echo .*password|echo .*database_url/i);
  assert.match(script, /kubectl delete secret "\$bootstrap_secret"/);
});
