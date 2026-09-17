import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));

function render(...args) {
  return execFileSync("helm", ["template", "open-triage", chart, "--show-only", "templates/ingress.yaml", ...args],
    { encoding: "utf8" });
}

test("authentication paths receive a separate ingress network safety limit", () => {
  const output = render();
  assert.match(output, /name: open-triage-authentication/);
  assert.match(output, /nginx\.ingress\.kubernetes\.io\/limit-rps: "10"/);
  assert.match(output, /nginx\.ingress\.kubernetes\.io\/limit-burst-multiplier: "3"/);
  assert.match(output, /path: \/api\/sessions/);
});

test("operators can disable or tune the ingress safety layer", () => {
  assert.doesNotMatch(render("--set", "ingress.authenticationRateLimit.enabled=false"),
    /name: open-triage-authentication/);
  assert.match(render("--set", "ingress.authenticationRateLimit.requestsPerSecond=25"),
    /nginx\.ingress\.kubernetes\.io\/limit-rps: "25"/);
});
