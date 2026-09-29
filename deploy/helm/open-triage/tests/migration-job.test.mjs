import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));

function render(...args) {
  return execFileSync("helm", ["template", "open-triage", chart, ...args], { encoding: "utf8" });
}

test("migration Job gates install and upgrade before application rollout", () => {
  const output = render();
  const job = output.slice(output.indexOf("# Source: open-triage/templates/migration-job.yaml"));

  assert.match(job, /kind: Job/);
  assert.match(job, /"helm\.sh\/hook": pre-install,pre-upgrade/);
  assert.match(job, /"helm\.sh\/hook-weight": "-5"/);
  assert.match(job, /backoffLimit: 0/);
  assert.match(job, /command: \["npm", "run", "migrate:runtime", "-w", "@open-triage\/database"\]/);
  assert.match(job, /secretKeyRef: \{ name: open-triage-migration-database, key: DATABASE_URL \}/);
});

test("successful migration state survives a later rollout failure", () => {
  const output = render();

  assert.match(output, /"helm\.sh\/hook-delete-policy": before-hook-creation/);
  assert.doesNotMatch(output, /hook-succeeded/);
});

test("deploy does not run the synthetic bootstrap", () => {
  const output = render();

  assert.doesNotMatch(output, /bootstrap:synthetic|bootstrap-synthetic-installation/);
});

test("demo deployment restores its idempotent synthetic installation before rollout", () => {
  const output = render("--values", fileURLToPath(new URL("../demo-reference.values.yaml", import.meta.url)));
  const job = output.slice(output.indexOf("# Source: open-triage/templates/migration-job.yaml"));

  assert.match(job, /command: \["npm", "run", "install:synthetic:runtime", "-w", "@open-triage\/database"\]/);
  assert.match(job, /name: PGOPTIONS\n\s+value: "-c lock_timeout=45s -c statement_timeout=8min"/);
  assert.match(job, /requests:\n\s+cpu: 10m\n\s+memory: 64Mi/);
});

test("migration gate requires a pre-existing cluster-owned Secret", () => {
  assert.throws(
    () => render(
      "--set", "secrets.migration.existingSecret=",
      "--set-string", "secrets.migration.databaseUrl=managed",
    ),
    /secrets\.migration\.existingSecret is required when migration\.enabled is true/,
  );

  const managed = render(
    "--set", "migration.enabled=false",
    "--set", "secrets.api.existingSecret=",
    "--set-string", "secrets.api.databaseUrl=managed",
    "--set-string", "secrets.api.patientKeyInstallationId=installation",
    "--set-string", "secrets.api.patientKeySecretBase64=key",
    "--set-string", "secrets.api.authRateLimitSecretBase64=auth-key",
    "--set-string", "secrets.api.offlineRecoverySecretBase64=offline-key",
  );
  assert.match(managed, /kind: Secret/);
  assert.doesNotMatch(managed, /kind: Job/);
});
