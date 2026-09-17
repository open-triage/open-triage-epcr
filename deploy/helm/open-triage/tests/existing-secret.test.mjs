import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));

function render(...args) {
  return execFileSync("helm", ["template", "open-triage", chart, ...args], {
    encoding: "utf8",
  });
}

test("existing-Secret mode references the cluster-owned Secret without rendering it", () => {
  const output = render();

  assert.doesNotMatch(output, /kind: Secret(?:\n|\r\n)/);
  assert.doesNotMatch(output, /stringData:/);
  assert.equal(
    output.match(/secretRef: \{ name: open-triage-database \}/g)?.length,
    5,
    "the migration, API, synthetic expiry, and both analytics workloads must reference the existing Secret",
  );
});

test("secret input changes cannot alter an existing Secret during an upgrade", () => {
  const before = render("--set-string", "secrets.databaseUrl=before-upgrade");
  const after = render(
    "--set-string",
    "secrets.databaseUrl=after-upgrade",
    "--set-string",
    "secrets.supabaseSecretKey=replacement-value",
  );

  assert.equal(after, before, "managed secret values must be ignored in existing-Secret mode");
  assert.doesNotMatch(after, /before-upgrade|after-upgrade|replacement-value/);
});

test("an explicitly named existing Secret is used by every workload", () => {
  const output = render("--set", "secrets.existingSecret=installation-database");

  assert.doesNotMatch(output, /kind: Secret(?:\n|\r\n)|stringData:/);
  assert.equal(output.match(/secretRef: \{ name: installation-database \}/g)?.length, 5);
});

test("managed-Secret mode remains available", () => {
  const output = render(
    "--set",
    "migration.enabled=false",
    "--set",
    "secrets.existingSecret=",
    "--set-string",
    "secrets.databaseUrl=managed-database-url",
    "--set-string",
    "secrets.patientKeyInstallationId=managed-installation",
    "--set-string",
    "secrets.patientKeySecretBase64=managed-key",
    "--set-string",
    "secrets.offlineRecoverySecretBase64=managed-offline-key",
  );

  assert.match(output, /kind: Secret(?:\n|\r\n)/);
  assert.match(output, /name: open-triage-database/);
  assert.match(output, /DATABASE_URL: \"managed-database-url\"/);
  assert.match(output, /OFFLINE_RECOVERY_SECRET_BASE64: \"managed-offline-key\"/);
});
