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
