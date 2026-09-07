# OpenTriage demo chart

This chart deploys the static web frontend, NestJS API, and analytics CronJobs.
PostgreSQL remains in Supabase Free. By default the chart references the
cluster-owned `open-triage-database` Secret; Helm neither renders its values nor
updates the Secret during upgrades.

Build the web image with the public API hostname embedded at build time:

```sh
docker build -f deploy/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.demo.opentriage.org \
  -t ghcr.io/open-triage/open-triage-web:demo .
docker build -f deploy/docker/api.Dockerfile \
  -t ghcr.io/open-triage/open-triage-api:demo .
```

Create the Secret outside Helm before the first install (or retain the existing
one when upgrading). It must contain `DATABASE_URL`, `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`, `PATIENT_KEY_INSTALLATION_ID`, `PATIENT_KEY_VERSION`, and
`PATIENT_KEY_SECRET_BASE64`. Keep the sensitive values in a private input file:

```sh
kubectl create secret generic open-triage-database \
  --namespace open-triage \
  --from-env-file=/private/path/open-triage-database.env
```

Install or upgrade the workloads without passing secret values to Helm:

```sh
helm upgrade --install open-triage ./deploy/helm/open-triage \
  --namespace open-triage --create-namespace
```

Helm runs a forward-only migration Job before each install or upgrade. The Job
reads `DATABASE_URL` from the cluster-owned Secret and must succeed before Helm
updates the application Deployments. Applied migration versions and checksums
are recorded in Supabase's standard
`supabase_migrations.schema_migrations` table. Checksums for migrations applied
by this runner are stored separately in
`open_triage_deploy.migration_checksums`, so reruns skip completed migrations
and reject later edits to files this runner applied. Each new migration is
committed in its own transaction. A failed migration is rolled back and stops
the release; a successful migration remains committed if a later application
rollout fails.

The migration Job deliberately does not run `bootstrap:synthetic`. Seed the
fictional installation once, as a separate operator action, when provisioning a
new demo database:

```sh
npm run bootstrap:synthetic -w @open-triage/database
```

To use a different cluster-owned Secret, set `secrets.existingSecret` to its
name. For installations where Helm should create the Secret, set
`secrets.existingSecret` to an empty string and supply the other `secrets` values
in a private values file, and set `migration.enabled=false` after arranging a
separate pre-rollout migration mechanism. A Helm hook cannot consume a Secret
that the same release has not created yet. Do not switch an already Helm-managed
Secret to existing-Secret mode without first transferring its ownership outside
the release.

Set `web.replicas` and `api.replicas` to `3` when the cluster has three worker
nodes. The current defaults are deliberately one replica for a one-node demo.
