import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));
const demoValues = fileURLToPath(new URL("../demo-reference.values.yaml", import.meta.url));

function renderDemo() {
  return execFileSync("helm", [
    "template",
    "open-triage",
    chart,
    "--values",
    demoValues,
  ], { encoding: "utf8" });
}

test("demo values preserve private image access for every workload", () => {
  const output = renderDemo();

  assert.equal(
    output.match(/imagePullSecrets:\n\s+- name: ghcr-pull/g)?.length,
    6,
    "web, API, migration, synthetic expiry, and both analytics workloads must use the GHCR pull Secret",
  );
});

test("demo values preserve public TLS and workload-specific cluster-owned database Secrets", () => {
  const output = renderDemo();

  assert.match(output, /tls:\n\s+- hosts:\n\s+- demo\.opentriage\.org\n\s+- api\.demo\.opentriage\.org\n\s+secretName: open-triage-tls/);
  for (const name of [
    "open-triage-api-database", "open-triage-migration-database",
    "open-triage-analytics-projector-database", "open-triage-analytics-health-database",
    "open-triage-retention-database"
  ]) assert.match(output, new RegExp(`name: ${name}, key: DATABASE_URL`));
  assert.doesNotMatch(output, /envFrom:/);
  assert.doesNotMatch(output, /kind: Secret(?:\n|\r\n)|stringData:/);
});

test("demo batch workloads remain schedulable on the single-node cluster", () => {
  const output = renderDemo();
  const migration = output.slice(
    output.indexOf("# Source: open-triage/templates/migration-job.yaml"),
  );
  const projector = output.slice(
    output.indexOf("name: open-triage-analytics-projector"),
    output.indexOf("name: open-triage-analytics-health"),
  );

  assert.match(migration, /requests:\n\s+cpu: 10m\n\s+memory: 128Mi/);
  assert.match(projector, /requests:\n\s+cpu: 25m\n\s+memory: 128Mi/);
});
