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

test("demo values preserve public TLS and the cluster-owned database Secret", () => {
  const output = renderDemo();

  assert.match(output, /tls:\n\s+- hosts:\n\s+- demo\.opentriage\.org\n\s+- api\.demo\.opentriage\.org\n\s+secretName: open-triage-tls/);
  assert.equal(output.match(/secretRef: \{ name: open-triage-database \}/g)?.length, 5);
  assert.doesNotMatch(output, /kind: Secret(?:\n|\r\n)|stringData:/);
});
