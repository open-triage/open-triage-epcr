import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const migrationFile = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/;

export async function migrationInventory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const inventory = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    const match = migrationFile.exec(entry.name);
    if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
    const sql = await readFile(path.join(directory, entry.name));
    inventory.push({
      file: entry.name,
      version: match[1],
      name: match[2],
      sha256: createHash("sha256").update(sql).digest("hex"),
    });
  }
  inventory.sort((left, right) => left.version.localeCompare(right.version));
  return inventory;
}

export function verifyPreviousReleaseManifest(manifest, inventory, fixtureData) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.migrations)) {
    throw new Error("Previous-release fixture manifest must use schemaVersion 1");
  }
  const expected = inventory.filter(({ version }) => version <= manifest.lastMigration);
  if (expected.length !== manifest.migrations.length) {
    throw new Error(
      `Previous-release migration inventory has ${manifest.migrations.length} entries; expected ${expected.length}`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = expected[index];
    const recorded = manifest.migrations[index];
    if (recorded.file !== actual.file || recorded.sha256 !== actual.sha256) {
      throw new Error(`Applied migration fixture is immutable: ${recorded.file ?? actual.file} differs`);
    }
  }
  if (expected.at(-1)?.version !== manifest.lastMigration) {
    throw new Error(`Previous-release cutoff ${manifest.lastMigration} is not a migration version`);
  }
  const dataChecksum = createHash("sha256").update(fixtureData).digest("hex");
  if (dataChecksum !== manifest.data.sha256) {
    throw new Error("Previous-release bounded data checksum differs from its manifest");
  }
  return expected;
}

export function rejectNonAdditiveMigrationChanges(changes) {
  const rejected = changes.filter(({ status }) => status !== "A");
  if (rejected.length) {
    const summary = rejected.map(({ status, paths }) => `${status} ${paths.join(" -> ")}`).join(", ");
    throw new Error(`Applied migrations are immutable; add a corrective migration instead: ${summary}`);
  }
  for (const { paths } of changes) {
    const added = paths.at(-1);
    if (!migrationFile.test(path.basename(added))) {
      throw new Error(`New migration has an invalid filename: ${added}`);
    }
  }
}

export function parseNameStatus(output) {
  const tokens = output.split("\0").filter(Boolean);
  const changes = [];
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    const pathCount = /^[RC]/.test(status) ? 2 : 1;
    changes.push({ status: status[0], paths: tokens.slice(index, index + pathCount) });
    index += pathCount;
  }
  return changes;
}

export async function verifyForwardOnlyMigrations({ repositoryRoot, baseRef } = {}) {
  const root = repositoryRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const migrationsDirectory = path.join(root, "supabase/migrations");
  const fixtureDirectory = path.join(root, "packages/database/fixtures/previous-release/2026-09-23");
  const [manifestText, fixtureData, inventory] = await Promise.all([
    readFile(path.join(fixtureDirectory, "manifest.json"), "utf8"),
    readFile(path.join(fixtureDirectory, "data.sql"), "utf8"),
    migrationInventory(migrationsDirectory),
  ]);
  const manifest = JSON.parse(manifestText);
  verifyPreviousReleaseManifest(manifest, inventory, fixtureData);

  if (baseRef) {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--name-status", "-z", baseRef, "HEAD", "--", "supabase/migrations"],
      { cwd: root, encoding: "utf8" },
    );
    rejectNonAdditiveMigrationChanges(parseNameStatus(stdout));
  }
  return { manifest, inventory };
}

async function main() {
  const baseIndex = process.argv.indexOf("--base-ref");
  const baseRef = baseIndex === -1 ? undefined : process.argv[baseIndex + 1];
  if (baseIndex !== -1 && !baseRef) throw new Error("--base-ref requires a Git ref");
  const { manifest, inventory } = await verifyForwardOnlyMigrations({ baseRef });
  console.log(JSON.stringify({
    event: "forward_only_migrations_verified",
    previousRelease: manifest.release,
    previousMigrationCount: manifest.migrations.length,
    currentMigrationCount: inventory.length,
    comparedWith: baseRef ?? null,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
