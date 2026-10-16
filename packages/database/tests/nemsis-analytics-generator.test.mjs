import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { nextMigrationVersion } from "../scripts/migration-version.mjs";

const packageRoot = path.resolve(import.meta.dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const generator = path.join(packageRoot, "scripts/generate-nemsis-analytics.mjs");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "open-triage-nemsis-generator-"));
  const migrations = path.join(root, "migrations");
  const initialMigration = path.join(migrations, "202608300001_initial.sql");
  const identifying = path.join(root, "identifying-elements.json");
  await mkdir(migrations, { recursive: true });
  await Promise.all([
    writeFile(initialMigration, "-- immutable applied migration\n"),
    writeFile(identifying, await readFile(path.join(packageRoot, "config/identifying-elements.json"), "utf8"))
  ]);
  return {
    root,
    migrations,
    initialMigration,
    identifying,
    output: path.join(root, "mapping.json"),
    state: path.join(root, "state.json")
  };
}

async function generate(paths, ...extra) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [
      generator,
      "--catalog", path.join(repoRoot, "defines/catalog/catalog_nemsis-3.5.1.json"),
      "--identifying", paths.identifying,
      "--group-times", path.join(packageRoot, "config/repeating-group-times.json"),
      "--output", paths.output,
      "--state", paths.state,
      "--migrations", paths.migrations,
      ...extra
    ], (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

test("generated versions use UTC and follow ordinary migrations across clock skew and midnight", () => {
  const now = new Date("2026-10-16T23:59:59Z");
  assert.equal(nextMigrationVersion([], now), "20261016235959");
  assert.equal(nextMigrationVersion(["20261016235959_ordinary.sql"], now), "20261017000000");
  assert.equal(nextMigrationVersion(["20261016235959_ordinary.sql"], new Date("2026-10-15")), "20261017000000");
  assert.throws(() => nextMigrationVersion(["30000000000001_legacy.sql"], now), /invalid migration timestamp/);
});

test("analytics generation is append-only across initial, no-op, and changed definitions", async () => {
  const paths = await fixture();
  const frozenInitial = await readFile(paths.initialMigration, "utf8");
  // A peer's ordinary migration must precede generated SQL, even with clock skew.
  const ordinaryName = "20991231235959_ordinary.sql";
  await writeFile(path.join(paths.migrations, ordinaryName), "select 1;");

  await generate(paths);
  const firstOutput = await readFile(paths.output, "utf8");
  const firstName = JSON.parse(await readFile(paths.state, "utf8")).migration;
  assert.match(firstName, new RegExp(`^[0-9]{14}_nemsis_analytics_${digest(firstOutput).slice(0, 12)}\\.sql$`));
  const firstMigration = await readFile(path.join(paths.migrations, firstName), "utf8");
  assert.equal(firstName.split("_")[0], "21000101000000");
  assert.equal(await readFile(paths.initialMigration, "utf8"), frozenInitial);

  await generate(paths);
  assert.deepEqual((await readdir(paths.migrations)).sort(), ["202608300001_initial.sql", ordinaryName, firstName].sort());
  assert.equal(await readFile(path.join(paths.migrations, firstName), "utf8"), firstMigration);

  const identifying = JSON.parse(await readFile(paths.identifying, "utf8"));
  identifying.elements = identifying.elements.filter((element) => element !== "eScene.20");
  await writeFile(paths.identifying, `${JSON.stringify(identifying, null, 2)}\n`);

  await generate(paths);
  const changedOutput = await readFile(paths.output, "utf8");
  const changedName = JSON.parse(await readFile(paths.state, "utf8")).migration;
  assert.ok(changedName > firstName);
  assert.ok(changedName.endsWith(`_nemsis_analytics_${digest(changedOutput).slice(0, 12)}.sql`));
  const changedMigration = await readFile(path.join(paths.migrations, changedName), "utf8");
  assert.match(changedMigration, /\n  escene_20,/);
  assert.equal(await readFile(paths.initialMigration, "utf8"), frozenInitial);
  assert.equal(await readFile(path.join(paths.migrations, firstName), "utf8"), firstMigration);

  const state = JSON.parse(await readFile(paths.state, "utf8"));
  assert.deepEqual(state, {
    schemaVersion: "1.0.0",
    sequence: 2,
    mappingSha256: digest(changedOutput),
    migration: changedName
  });
  await generate(paths, "--check");
});
