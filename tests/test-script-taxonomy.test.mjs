import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const readPackage = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("root scripts expose each maintained kind of test coverage", async () => {
  const packageJson = await readPackage("package.json");

  for (const name of [
    "test:unit",
    "test:integration",
    "test:deployment",
    "test:helm",
    "test:a11y",
    "test:e2e",
    "test:e2e:critical",
    "test:workflow",
  ]) assert.equal(typeof packageJson.scripts[name], "string", `missing root script ${name}`);

  assert.match(packageJson.scripts.test, /test:unit/);
  assert.match(packageJson.scripts.test, /test:workflow/);
});

test("workspace scripts distinguish unit, integration, accessibility, deployment, and browser tests", async () => {
  const [api, database, web] = await Promise.all([
    readPackage("apps/api/package.json"),
    readPackage("packages/database/package.json"),
    readPackage("apps/web/package.json"),
  ]);

  for (const workspace of [api, database, web]) {
    assert.match(workspace.scripts.test, /test:unit/);
    assert.equal(typeof workspace.scripts["test:unit"], "string");
  }
  assert.equal(typeof api.scripts["test:integration"], "string");
  assert.equal(typeof database.scripts["test:integration"], "string");
  for (const name of ["test:a11y", "test:deployment", "test:e2e", "test:e2e:critical"]) {
    assert.equal(typeof web.scripts[name], "string", `missing web script ${name}`);
  }
  assert.notEqual(web.scripts["test:a11y"], web.scripts["test:e2e"]);
});

test("the complete browser command covers static and protected server modes with fresh servers", async () => {
  const web = await readPackage("apps/web/package.json");
  const config = await readFile(new URL("apps/web/playwright.config.ts", root), "utf8");
  assert.match(web.scripts["test:e2e"], /^OPEN_TRIAGE_E2E_SERVER_MODE=false playwright test .* && OPEN_TRIAGE_E2E_SERVER_MODE=true playwright test /);
  assert.match(web.scripts["test:a11y"], /^OPEN_TRIAGE_E2E_SERVER_MODE=true /);
  assert.match(config, /serverBackedMock \? \{ testMatch: serverTests \} : \{ testIgnore: \["deployment.spec.ts", \.\.\.serverTests\] \}/);
  assert.match(config, /reuseExistingServer: false/);
  for (const spec of ["browser-persistence.spec.ts", "complete-mobile-journey.spec.ts", "assigned-calls.spec.ts"]) {
    assert.ok(config.includes(`"${spec}"`), `${spec} must run with protected server persistence`);
  }
});
