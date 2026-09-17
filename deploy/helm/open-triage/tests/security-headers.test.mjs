import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const chart = fileURLToPath(new URL("..", import.meta.url));

test("production ingress redirects HTTP at TLS termination", () => {
  const output = execFileSync("helm", [
    "template", "open-triage", chart,
    "--show-only", "templates/ingress.yaml",
  ], { encoding: "utf8" });

  assert.match(output, /nginx\.ingress\.kubernetes\.io\/ssl-redirect: "true"/);
  assert.match(output, /nginx\.ingress\.kubernetes\.io\/force-ssl-redirect: "true"/);
  assert.doesNotMatch(output, /nginx\.ingress\.kubernetes\.io\/hsts/,
    "ingress-nginx exposes HSTS through its controller ConfigMap, not Ingress annotations");
});
