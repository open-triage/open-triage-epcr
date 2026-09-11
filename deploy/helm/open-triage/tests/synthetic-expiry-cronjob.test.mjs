import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));

function render(...args) {
  return execFileSync("helm", [
    "template", "open-triage", chart,
    "--show-only", "templates/synthetic-expiry-cronjob.yaml",
    ...args,
  ], { encoding: "utf8" });
}

test("the server purge runs every minute with overlap forbidden", () => {
  const output = render(
    "--set-string", "api.image.repository=registry.example/open-triage-api",
    "--set-string", "api.image.tag=expiry-sha",
    "--set", "secrets.existingSecret=clinical-database",
  );
  assert.match(output, /kind: CronJob/);
  assert.match(output, /name: open-triage-synthetic-expiry/);
  assert.match(output, /schedule: "\* \* \* \* \*"/);
  assert.match(output, /concurrencyPolicy: Forbid/);
  assert.match(output, /command: \["npm", "run", "purge:synthetic", "-w", "@open-triage\/database"\]/);
  assert.match(output, /image: "registry\.example\/open-triage-api:expiry-sha"/);
  assert.match(output, /secretRef: \{ name: clinical-database \}/);
});

test("the purge workload can be disabled independently", () => {
  const output = execFileSync("helm", [
    "template", "open-triage", chart,
    "--set", "syntheticExpiry.enabled=false",
  ], { encoding: "utf8" });
  assert.doesNotMatch(output, /name: open-triage-synthetic-expiry/);
});
