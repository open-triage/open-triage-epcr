import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));
const template = new URL("../templates/analytics-cronjobs.yaml", import.meta.url);
const retiredManifest = new URL("../../../kubernetes/analytics-projector-cronjobs.yaml", import.meta.url);

function render(...args) {
  return execFileSync("helm", [
    "template",
    "open-triage",
    chart,
    "--show-only",
    "templates/analytics-cronjobs.yaml",
    ...args,
  ], { encoding: "utf8" });
}

test("the chart is the only maintained analytics CronJob source", async () => {
  await assert.rejects(access(retiredManifest), { code: "ENOENT" });
  assert.equal((await readFile(template, "utf8")).match(/kind: CronJob/g)?.length, 2);
});

test("the canonical render preserves both analytics workloads", () => {
  const output = render(
    "--set-string", "api.image.repository=registry.example/open-triage-api",
    "--set-string", "api.image.tag=release-sha",
    "--set", "api.image.pullPolicy=Always",
    "--set", "secrets.analyticsProjector.existingSecret=projector-database",
    "--set", "secrets.analyticsHealth.existingSecret=health-database",
  );

  assert.equal(output.match(/kind: CronJob/g)?.length, 2);
  assert.match(output, /name: open-triage-analytics-projector/);
  assert.match(output, /name: open-triage-analytics-health/);
  assert.match(output, /schedule: "\*\/2 \* \* \* \*"/);
  assert.match(output, /schedule: "\* \* \* \* \*"/);
  assert.equal(output.match(/concurrencyPolicy: Forbid/g)?.length, 2);
  assert.equal(output.match(/image: "registry\.example\/open-triage-api:release-sha"/g)?.length, 2);
  assert.equal(output.match(/imagePullPolicy: Always/g)?.length, 2);
  assert.equal(output.match(/secretKeyRef: \{ name: projector-database, key: DATABASE_URL \}/g)?.length, 1);
  assert.equal(output.match(/secretKeyRef: \{ name: health-database, key: DATABASE_URL \}/g)?.length, 1);
  assert.match(output, /command: \["npm", "run", "project", "-w", "@open-triage\/database"\]/);
  assert.match(output, /command: \["npm", "run", "project:health", "-w", "@open-triage\/database"\]/);
  assert.match(output, /ANALYTICS_PROJECTOR_BATCH_SIZE\n\s+value: "500"/);
  assert.match(output, /ANALYTICS_PROJECTOR_MAX_ATTEMPTS\n\s+value: "12"/);
  assert.match(output, /ANALYTICS_PROJECTOR_FRESHNESS_TARGET_SECONDS\n\s+value: "300"/);
  assert.match(output, /activeDeadlineSeconds: 110[\s\S]*backoffLimit: 1/);
  assert.match(output, /activeDeadlineSeconds: 50[\s\S]*backoffLimit: 0/);
  assert.match(output, /limits:\n\s+cpu: 500m\n\s+memory: 512Mi[\s\S]*requests:\n\s+cpu: 100m\n\s+memory: 128Mi/);
  assert.match(output, /limits:\n\s+cpu: 100m\n\s+memory: 128Mi[\s\S]*requests:\n\s+cpu: 25m\n\s+memory: 64Mi/);
});

test("analytics values flow into generated raw manifests", () => {
  const output = render(
    "--set-string", "analytics.schedule=7 1 * * *",
    "--set-string", "analytics.healthSchedule=11 * * * *",
    "--set", "analytics.batchSize=750",
    "--set", "analytics.maxAttempts=9",
    "--set", "analytics.freshnessTargetSeconds=420",
    "--set-string", "analytics.resources.requests.cpu=175m",
    "--set-string", "analytics.healthResources.limits.memory=192Mi",
  );

  assert.match(output, /schedule: "7 1 \* \* \*"/);
  assert.match(output, /schedule: "11 \* \* \* \*"/);
  assert.match(output, /ANALYTICS_PROJECTOR_BATCH_SIZE\n\s+value: "750"/);
  assert.match(output, /ANALYTICS_PROJECTOR_MAX_ATTEMPTS\n\s+value: "9"/);
  assert.match(output, /ANALYTICS_PROJECTOR_FRESHNESS_TARGET_SECONDS\n\s+value: "420"/);
  assert.match(output, /requests:\n\s+cpu: 175m/);
  assert.match(output, /limits:\n\s+cpu: 100m\n\s+memory: 192Mi/);
});
