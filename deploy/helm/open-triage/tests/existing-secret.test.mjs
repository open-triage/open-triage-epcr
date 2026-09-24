import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));
function render(...args) {
  return execFileSync("helm", ["template", "open-triage", chart, ...args], { encoding: "utf8" });
}

test("existing-Secret mode mounts one database credential per workload", () => {
  const output = render();
  assert.doesNotMatch(output, /kind: Secret(?:\n|\r\n)|envFrom:/);
  for (const name of [
    "open-triage-api-database",
    "open-triage-analytics-projector-database", "open-triage-analytics-health-database",
    "open-triage-retention-database"
  ]) assert.match(output, new RegExp(`name: ${name}, key: DATABASE_URL`));
  assert.equal(output.match(/key: DATABASE_URL/g)?.length, 4);
  assert.match(output, /key: AUTH_RATE_LIMIT_SECRET_BASE64/);
  assert.match(output, /key: OFFLINE_RECOVERY_KEY_VERSION/);
  assert.match(output, /key: OFFLINE_RECOVERY_SECRET_BASE64/);
});

test("each workload can select a different existing Secret", () => {
  const output = render(
    "--set", "secrets.api.existingSecret=api-db",
    "--set", "secrets.analyticsProjector.existingSecret=projector-db",
    "--set", "secrets.analyticsHealth.existingSecret=health-db",
    "--set", "secrets.retention.existingSecret=retention-db",
  );
  for (const name of ["api-db", "projector-db", "health-db", "retention-db"]) {
    assert.match(output, new RegExp(`name: ${name}, key: DATABASE_URL`));
  }
});

test("managed Secrets remain separate and never copy one DATABASE_URL", () => {
  const output = render(
    "--set", "secrets.api.existingSecret=",
    "--set-string", "secrets.api.databaseUrl=api-url",
    "--set-string", "secrets.api.patientKeyInstallationId=installation",
    "--set-string", "secrets.api.patientKeySecretBase64=patient-key",
    "--set-string", "secrets.api.authRateLimitSecretBase64=auth-rate-limit-key",
    "--set-string", "secrets.api.offlineRecoverySecretBase64=offline-recovery-key",
    "--set", "secrets.analyticsProjector.existingSecret=",
    "--set-string", "secrets.analyticsProjector.databaseUrl=projector-url",
    "--set", "secrets.analyticsHealth.existingSecret=",
    "--set-string", "secrets.analyticsHealth.databaseUrl=health-url",
    "--set", "secrets.retention.existingSecret=",
    "--set-string", "secrets.retention.databaseUrl=retention-url",
    "--set", "secrets.operationalAudit.existingSecret=",
    "--set-string", "secrets.operationalAudit.databaseUrl=audit-url",
  );
  assert.equal(output.match(/kind: Secret/g)?.length, 5);
  for (const [name, url] of [
    ["api", "api-url"], ["analytics-projector", "projector-url"],
    ["analytics-health", "health-url"], ["retention", "retention-url"],
    ["operational-audit", "audit-url"]
  ]) assert.match(output, new RegExp(`name: open-triage-${name}-database[\\s\\S]*?DATABASE_URL: "${url}"`));
  assert.match(output, /AUTH_RATE_LIMIT_SECRET_BASE64: "auth-rate-limit-key"/);
  assert.match(output, /OFFLINE_RECOVERY_SECRET_BASE64: "offline-recovery-key"/);
});
