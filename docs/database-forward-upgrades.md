# Forward-only database upgrades

OpenTriage validates every release both as a clean installation and as an
upgrade from a versioned N-1 database. The current fixture is
`packages/database/fixtures/previous-release/2026-09-23`; it represents the
release ending at migration `20260923120000` and contains no patient or other
real-world data.

The fixture manifest records the pinned PostgreSQL image, managed-compatible
role topology, `pgcrypto` placement, every applied migration checksum, and the
bounded synthetic rows in `data.sql`. Materialization runs those locked
migrations through the same migration implementation shipped in the API runtime
image, then loads one fictional organization, owner, protected-role topology,
and sealed catalog marker. Editing fixture data or any migration at or before
the cutoff invalidates its checksum. On pull requests, CI also rejects modified,
renamed, or deleted migration files; corrections must be a newly timestamped
forward migration.

The runtime-image validation creates two managed-compatible databases on the
pinned `postgres:15.19-bookworm` image and immutable digest. One is installed cleanly at the current
revision. The other is materialized at N-1 and upgraded with the exact current
runtime image. CI then:

1. runs the current migrator twice and requires the second run to be a no-op;
2. compares deterministic schema-only dumps of the clean and upgraded databases;
3. loads the production NEMSIS catalog and provisions isolated workload logins;
4. verifies fixture preservation, authorization, catalog loading, migration
   checksums, least-privileged operational access, and API health.

Schema equivalence currently has no accepted database-object differences. The
comparison normalizes only `pg_dump` restriction tokens and client/server
version comments, which are environment metadata rather than schema. Owners,
grants, functions, policies, triggers, constraints, indexes, and extension
placement remain in the comparison. The fixture's bounded rows and migration
timestamps are data and therefore intentionally outside the schema-only diff;
their required contents are verified separately.

## Advancing the fixture

Advance N-1 only as an explicit release-maintenance change:

1. choose the last migration shipped by the previous release;
2. update the release, cutoff, and directory in
   `generate-previous-release-manifest.mjs` and the fixture documentation;
3. keep `data.sql` fictional, minimal, deterministic, and free of secrets;
4. run `npm run fixture:previous-release:generate -w @open-triage/database`;
5. run `npm run fixture:previous-release:verify -w @open-triage/database` and
   the clean/upgrade CI lanes.

Never regenerate the manifest to legitimize an edit to an applied migration.
Add a corrective migration and prove that both installation paths converge.
