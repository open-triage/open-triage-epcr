import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { migrationInventory } from "./verify-forward-only-migrations.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
const fixtureDirectory = path.join(
  repositoryRoot,
  "packages/database/fixtures/previous-release/2026-09-23",
);
const lastMigration = "20260923120000";
const data = await readFile(path.join(fixtureDirectory, "data.sql"));
const migrations = (await migrationInventory(path.join(repositoryRoot, "supabase/migrations")))
  .filter(({ version }) => version <= lastMigration)
  .map(({ file, sha256 }) => ({ file, sha256 }));

const manifest = {
  schemaVersion: 1,
  release: "n-1-2026-09-23",
  description: "Sanitized, deterministic previous-release fixture with no patient data",
  lastMigration,
  migrations,
  database: {
    engine: "postgres:15.19-bookworm@sha256:539ceaaae49b3a7c8a04467cf00cc6788d8e3f1675df41860d86eebc4c40524f",
    semantics: "managed-compatible",
    migrationRole: "open_triage_ci_migration",
    platformRoles: ["anon", "authenticated", "authenticator", "service_role"],
    runtimeRoles: [
      "open_triage_analytics_health",
      "open_triage_analytics_projector",
      "open_triage_api_runtime",
      "open_triage_operational_audit_writer",
      "open_triage_retention",
    ],
    extensions: { pgcrypto: { schema: "extensions" } },
  },
  data: {
    file: "data.sql",
    sha256: createHash("sha256").update(data).digest("hex"),
    containsPhi: false,
    expectedRows: { organizations: 1, users: 1, installationOwners: 1, catalogReleases: 1 },
  },
  schemaComparison: {
    expectedDifferences: [],
    normalization: [
      "pg_dump restriction tokens",
      "pg_dump client and server version comments",
    ],
  },
};

await writeFile(path.join(fixtureDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
