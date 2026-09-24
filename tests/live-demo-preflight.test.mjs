import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  availableCapacity,
  cpuMillis,
  memoryBytes,
  podRequests,
  recreateDeploymentCapacity,
  rolloutConflicts,
  validateSummary,
} from "../scripts/live-demo-preflight.mjs";

const workflowPath = new URL("../.github/workflows/demo-validation.yml", import.meta.url);
const sha = "0123456789abcdef0123456789abcdef01234567";

test("Kubernetes resource quantities produce bounded free capacity", () => {
  assert.equal(cpuMillis("1500m"), 1500);
  assert.equal(cpuMillis("2"), 2000);
  assert.equal(memoryBytes("2Gi"), 2 * 2 ** 30);
  const capacity = availableCapacity(
    { items: [{ spec: {}, status: { allocatable: { cpu: "2", memory: "2Gi" } } }] },
    { items: [{ spec: { nodeName: "node", containers: [{ resources: { requests: { cpu: "250m", memory: "128Mi" } } }] }, status: { phase: "Running" } }] },
  );
  assert.deepEqual(capacity, { cpu: 1750, memory: 1920 * 2 ** 20 });
});

test("pod requests follow Kubernetes init-container scheduling semantics", () => {
  assert.deepEqual(podRequests({ spec: {
    containers: [
      { resources: { requests: { cpu: "10m", memory: "32Mi" } } },
      { resources: { requests: { cpu: "300m", memory: "300Mi" } } },
    ],
    initContainers: [
      { resources: { requests: { cpu: "100m", memory: "100Mi" } } },
      { resources: { requests: { cpu: "100m", memory: "10Mi" } } },
    ],
    overhead: { cpu: "5m", memory: "4Mi" },
  } }), { cpu: 315, memory: 336 * 2 ** 20 });

  assert.deepEqual(podRequests({ spec: {
    containers: [{ resources: { requests: { cpu: "100m", memory: "64Mi" } } }],
    initContainers: [
      { restartPolicy: "Always", resources: { requests: { cpu: "20m", memory: "16Mi" } } },
      { resources: { requests: { cpu: "200m", memory: "128Mi" } } },
    ],
  } }), { cpu: 220, memory: 144 * 2 ** 20 });
});

test("capacity credits only pods released by matching Recreate deployments", () => {
  const pods = { items: [
    { metadata: { namespace: "open-triage", labels: { component: "api" } }, spec: { nodeName: "node", containers: [{ resources: { requests: { cpu: "100m", memory: "256Mi" } } }] }, status: { phase: "Running" } },
    { metadata: { namespace: "open-triage", labels: { component: "web" } }, spec: { nodeName: "node", containers: [{ resources: { requests: { cpu: "25m", memory: "32Mi" } } }] }, status: { phase: "Running" } },
    { metadata: { namespace: "open-triage", labels: { component: "projector" } }, spec: { nodeName: "node", containers: [{ resources: { requests: { cpu: "100m", memory: "128Mi" } } }] }, status: { phase: "Running" } },
    { metadata: { namespace: "other", labels: { component: "api" } }, spec: { nodeName: "node", containers: [{ resources: { requests: { cpu: "500m", memory: "1Gi" } } }] }, status: { phase: "Running" } },
  ] };
  const deployments = { items: [
    { metadata: { namespace: "open-triage" }, spec: { strategy: { type: "Recreate" }, selector: { matchLabels: { component: "api" } } } },
    { metadata: { namespace: "open-triage" }, spec: { strategy: { type: "RollingUpdate" }, selector: { matchLabels: { component: "projector" } } } },
    { metadata: { namespace: "open-triage" }, spec: { strategy: { type: "Recreate" }, selector: { matchLabels: { component: "missing" } } } },
  ] };

  assert.deepEqual(recreateDeploymentCapacity(pods, deployments, "open-triage"), {
    cpu: 100,
    memory: 256 * 2 ** 20,
  });
  assert.deepEqual(
    availableCapacity(
      { items: [{ spec: {}, status: { allocatable: { cpu: "1", memory: "2Gi" } } }] },
      pods,
      { deployments, namespace: "open-triage" },
    ),
    { cpu: 375, memory: 864 * 2 ** 20 },
  );
});

test("active, failed, and stuck rollout batch work is rejected", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const conflicts = rolloutConflicts(
    { items: [
      { metadata: { name: "open-triage-active", creationTimestamp: "2026-09-24T11:59:00Z" }, status: { active: 1 } },
      { metadata: { name: "open-triage-stuck", creationTimestamp: "2026-09-24T11:00:00Z" }, status: { active: 1 } },
      { metadata: { name: "unrelated" }, status: { active: 1 } },
    ] },
    { items: [{ metadata: { name: "open-triage-cron" }, status: { active: [{ name: "job" }] } }] },
    now,
  );
  assert.deepEqual(conflicts, [
    "cronjob/open-triage-cron:active",
    "job/open-triage-active:active-or-failed",
    "job/open-triage-stuck:stuck",
  ]);
});

test("deployment accepts only a fresh matching successful summary", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const summary = {
    schemaVersion: 1,
    status: "pass",
    sourceCommit: sha,
    checkedAt: "2026-09-24T11:55:00Z",
    cluster: { namespaceUid: "uid-1" },
  };
  assert.equal(validateSummary(summary, { sha, namespaceUid: "uid-1", maxAgeSeconds: 600, now }), summary);
  assert.throws(() => validateSummary({ ...summary, status: "fail" }, { sha, maxAgeSeconds: 600, now }), /did not pass/);
  assert.throws(() => validateSummary(summary, { sha, namespaceUid: "uid-2", maxAgeSeconds: 600, now }), /different cluster/);
  assert.throws(() => validateSummary(summary, { sha, maxAgeSeconds: 60, now }), /stale/);
});

test("live preflight is a hard gate before every deployment mutation", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflight = workflow.slice(workflow.indexOf("  live-demo-preflight:"), workflow.indexOf("  promote-api-image:"));
  const publishing = workflow.slice(workflow.indexOf("  promote-api-image:"), workflow.indexOf("  publish-image-manifest:"));
  const preparation = workflow.slice(workflow.indexOf("  prepare-demo-database:"), workflow.indexOf("  deploy-demo:"));
  const deployment = workflow.slice(workflow.indexOf("  deploy-demo:"));

  assert.match(preflight, /^    needs: deployment-authorization$/m);
  assert.match(preflight, /node scripts\/live-demo-preflight\.mjs run/);
  assert.match(preflight, /live-demo-preflight-\$\{\{ inputs\.deployment_revision \|\| github\.sha \}\}/);
  assert.doesNotMatch(preflight, /docker push|kubectl (?:apply|create|delete|patch)|helm upgrade/);
  assert.match(publishing, /needs\.live-demo-preflight\.result == 'success'/);
  assert.equal((publishing.match(/^    needs: live-demo-preflight$/gm) ?? []).length, 2);
  assert.match(preparation, /node scripts\/live-demo-preflight\.mjs verify/);
  assert.ok(preparation.indexOf("live-demo-preflight.mjs verify") < preparation.indexOf("prepare-demo-database.sh"));
  assert.ok(preparation.indexOf("live-demo-preflight.mjs verify") < preparation.indexOf("provision-demo-workload-secrets.sh"));
  assert.match(deployment, /node scripts\/live-demo-preflight\.mjs verify/);
  assert.ok(deployment.indexOf("live-demo-preflight.mjs verify") < deployment.indexOf("helm upgrade --install"));
});
