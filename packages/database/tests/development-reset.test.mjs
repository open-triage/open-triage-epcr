import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { developmentDatabaseTarget, requireResetConfirmation } from "../scripts/reset-development-database.mjs";
import { readInstallDefinitions } from "../scripts/lib/install-definitions.mjs";

const repository = path.resolve(import.meta.dirname, "../../..");

test("development reset accepts only an explicit confirmation for a local PostgreSQL database", () => {
  assert.deepEqual(developmentDatabaseTarget("postgresql://dev:secret@127.0.0.1:54322/open_triage_dev"), {
    host: "127.0.0.1", port: "54322", database: "open_triage_dev",
  });
  assert.doesNotThrow(() => requireResetConfirmation(["--confirm-reset"]));
  assert.throws(() => requireResetConfirmation([]), /--confirm-reset/);
  assert.throws(() => developmentDatabaseTarget("postgresql://dev:secret@db.example.test/open_triage"),
    /Refusing to reset non-local database host/);
  assert.throws(() => developmentDatabaseTarget("postgresql://dev:secret@localhost/template1"),
    /Refusing to reset database/);
});

test("development reset discovers its default and available options from defines", async () => {
  const definitions = await readInstallDefinitions(path.join(repository, "defines"));
  assert.equal(definitions.pairs.filter(({ form }) => form.default === true).length, 1);
  assert.ok(definitions.pairs.length >= 1);
  assert.ok(definitions.pairs.every(({ catalogKey, validation, form }) =>
    catalogKey === definitions.defaultPair.catalogKey && validation.formKey === form.key));

  const source = await readFile(path.join(repository,
    "packages/database/scripts/reset-development-database.mjs"), "utf8");
  for (const installationName of ["nemsis-full", "sweden", "catalog_nemsis-3.5.1.json",
    "validation_nemsis-full.json"]) {
    assert.ok(!source.includes(installationName), `reset must not special-case ${installationName}`);
  }
  assert.match(source, /readInstallDefinitions/);
  assert.match(source, /definitions\.defaultPair\.key/);
  assert.match(source, /definitions\.pairs\.map/);
});

test("the pruned API runtime includes shared installation-definition discovery", async () => {
  const [dockerfile, manifestText, generator] = await Promise.all([
    readFile(path.join(repository, "deploy/docker/api.Dockerfile"), "utf8"),
    readFile(path.join(repository, "deploy/docker/api-runtime-manifest.json"), "utf8"),
    readFile(path.join(repository, "deploy/docker/generate-api-runtime.mjs"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.ok(manifest.operations.some(({ entrypoint }) =>
    entrypoint.endsWith("load-nemsis-catalog.mjs")));
  assert.match(generator, /copyModuleClosure/);
  assert.match(dockerfile, /COPY --from=build \/api-runtime\/ \.\//);
});
