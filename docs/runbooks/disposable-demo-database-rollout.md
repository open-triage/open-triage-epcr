# Disposable demo database rollout

The public demo deployment has an explicit `Prepare / Disposable demo database`
phase before Helm. It runs the exact API image recorded in the deployment image
manifest, retains the Kubernetes Job for one day, and uploads its status and
redacted logs for 14 days. Helm does not contain a database migration hook.

The protected `demo` environment must define `DEMO_DATABASE_EXPECTED_HOST` and
`DEMO_DATABASE_PROJECT_REF`. The database URL remains only in the cluster-owned
`open-triage-migration-database` Secret. Preparation requires all of these
independent identities to agree:

- `DEMO_DATABASE_TARGET=open-triage-public-disposable-demo`;
- the exact configured host, `postgres` database name, TLS requirement, and
  20-character Supabase project reference, using the direct or port 5432
  session-mode connection required for advisory locking;
- for a destructive run, exactly the known synthetic organization and
  `DEMO_DATABASE_RESET_CONFIRMATION=reinitialize-open-triage-public-disposable-demo`.

The ordinary mode is `migrate`. Set the protected environment variable
`DEMO_DATABASE_PREPARE_MODE` to `reinitialize` only for an intentional reset and
set the exact confirmation above for that run. Reinitialization drops only the
listed OpenTriage application schemas and its application-owned public helper;
it never drops Supabase platform schemas, the database, roles, or extensions.
An unknown organization, host, database, project, plaintext connection, missing
configuration, or unavailable database fails before destructive SQL.

Preparation is serialized with a PostgreSQL advisory lock. Each migration is
still its own short transaction and immutable migration history is checked. The
phase then loads the current NEMSIS catalog, ensures the fixed synthetic
organization, restores the synthetic accounts and fixtures, loads every current
definition and validation version, and verifies the resulting counts. These
operations are idempotent, so rerunning the same revision is safe after a
database or application failure.

Database changes are forward-only and are not undone by Helm rollback. A failed
application rollout therefore leaves the completed preparation Job, source
revision, preparation mode, safe summary, and redacted logs available for
diagnosis. Rerun the workflow at the same eligible revision after correcting the
application or infrastructure fault, provided it remains the current `main`
tip. Manual deployment rejects older revisions because their application may
be incompatible with database migrations that have already run. Do not use this path for a production
database. Repository guards reduce accidents but do not replace protected GitHub
environments, scoped cluster credentials, Supabase access controls, backups, or
branch protection against a deliberately malicious writer.

After Helm succeeds, the workflow verifies the public web response and security
headers, API health, production-equivalent installation configuration,
synthetic login, and authenticated assigned-call retrieval.
