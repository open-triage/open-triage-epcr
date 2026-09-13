# OpenTriage demo chart

This chart deploys the static web frontend, NestJS API, and analytics CronJobs.
PostgreSQL remains in Supabase Free. By default the chart references the
cluster-owned `open-triage-database` Secret; Helm neither renders its values nor
updates the Secret during upgrades.

The chart is the canonical source for both analytics CronJobs. Configure their
schedules, batch/retry/freshness limits, and resources under `analytics` in a
values file. They use `api.image` (including its pull policy),
`imagePullSecrets`, and the Secret selected by `secrets.existingSecret`.
Generate standalone YAML for inspection or another deployment tool from the
chart rather than maintaining a second manifest:

```sh
helm template open-triage ./deploy/helm/open-triage \
  --values /private/path/installation.values.yaml \
  --show-only templates/analytics-cronjobs.yaml \
  > /tmp/open-triage-analytics-cronjobs.yaml
```

Treat that file as generated output: change the chart or values and render it
again instead of editing it.

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
  --values ./deploy/helm/open-triage/demo-reference.values.yaml \
  --namespace open-triage --create-namespace
```

The committed demo reference values contain no credentials. They preserve the
cluster-owned `ghcr-pull` image pull Secret, `open-triage-tls` certificate, and
`open-triage-database` application Secret during repeatable upgrades.

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

The migration Job defaults to schema migrations only. The public demonstration
values set `migration.bootstrapSynthetic=true`, which runs the idempotent,
insert-only fixture bootstrap before every rollout. The target organization must
already exist; this creates only missing `demo.admin` and `demo.clinician`
accounts and never changes an existing account. For a one-time manual bootstrap, run:

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
