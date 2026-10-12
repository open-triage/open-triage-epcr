import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { load } from "js-yaml";
import { installationValues } from "../scripts/installation-values.mjs";

function fixture() {
  return load(readFileSync(new URL("../deploy/helm/open-triage/installation.example.values.yaml", import.meta.url), "utf8")
    .replaceAll("example.com", "agency.test").replaceAll("example-pool", "operator-selected-pool"));
}
const validate = (value) => installationValues(JSON.stringify(value));

test("one installation file controls placement, build origins and public-site routing", () => {
  const values = fixture();
  const result = validate(values);
  assert.deepEqual(result.values, values);
  assert.deepEqual(result.outputs, {
    "web-url": "https://demo.agency.test", "api-url": "https://api.demo.agency.test", "public-site-host": "agency.test",
  });
  values.publicSite.enabled = false;
  values.nodeSelector = {};
  assert.equal(validate(values).outputs["public-site-host"], "");
});

test("missing or example configuration cannot silently deploy onto shared defaults", () => {
  for (const input of ["", "[]", "[invalid", readFileSync(new URL("../deploy/helm/open-triage/installation.example.values.yaml", import.meta.url), "utf8")]) {
    assert.throws(() => installationValues(input));
  }
});

test("operator configuration cannot replace verified images or embed workload credentials", () => {
  for (const mutate of [
    (v) => { v.api.image = { digest: "sha256:other" }; },
    (v) => { v.web.image = { tag: "latest" }; },
    (v) => { v.secrets.api.databaseUrl = "private-credential"; },
    (v) => { v.secrets.api.existingSecret = ""; },
    (v) => { delete v.secrets.retention; },
    (v) => { v.migration.enabled = false; },
    (v) => { v.unrecognized = "private-credential"; },
  ]) {
    const values = fixture(); mutate(values);
    assert.throws(() => validate(values), (error) => !error.message.includes("private-credential"));
  }
});

test("installation hosts require TLS coverage and cannot inject build or Actions output syntax", () => {
  for (const mutate of [
    (v) => { v.api.host = "api.agency.test\nINJECTED=value"; },
    (v) => { v.api.host = "https://api.agency.test/path"; },
    (v) => { v.web.host = v.api.host; },
    (v) => { v.publicSite.host = v.web.host; },
    (v) => { v.publicSite.host = "agency.test; include /tmp/other;"; },
    (v) => { v.ingress.tls = []; },
    (v) => { v.nodeSelector = { pool: 123 }; },
  ]) {
    const values = fixture(); mutate(values); assert.throws(() => validate(values));
  }
});

test("CLI snapshots a local installation file without printing values or replacing an existing snapshot", () => {
  const directory = mkdtempSync(join(tmpdir(), "installation-values-"));
  try {
    const input = join(directory, "input.yaml");
    const output = join(directory, "snapshot.json");
    const actionsOutput = join(directory, "outputs");
    const values = fixture();
    writeFileSync(input, JSON.stringify(values));
    const args = [fileURLToPath(new URL("../scripts/installation-values.mjs", import.meta.url)), "--input", input, "--output", output];
    const options = { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: actionsOutput } };
    assert.equal(execFileSync(process.execPath, args, options), "");
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), values);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.match(readFileSync(actionsOutput, "utf8"), /^api-url=https:\/\/api\.demo\.agency\.test$/m);
    assert.throws(() => execFileSync(process.execPath, args, { ...options, stdio: "pipe" }), /EEXIST/);
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), values);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
