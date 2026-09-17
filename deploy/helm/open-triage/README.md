# OpenTriage demo chart

This chart deploys the static web frontend, NestJS API, and analytics CronJobs.
PostgreSQL remains in Supabase Free. By default the chart references separate
cluster-owned Secrets for each database workload; Helm neither renders their
values nor updates the Secrets during upgrades. See the
[workload credential runbook](../../../docs/runbooks/database-workload-credentials.md)
for role contracts, provisioning, and rotation.

The chart is the canonical source for both analytics CronJobs. Configure their
schedules, batch/retry/freshness limits, and resources under `analytics` in a
values file. They use `api.image` (including its pull policy),
`imagePullSecrets`, and the distinct Secrets selected by
`secrets.analyticsProjector.existingSecret` and
`secrets.analyticsHealth.existingSecret`.
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

Create the Secrets outside Helm before the first install (or retain existing
ones when upgrading). Every Secret contains only `DATABASE_URL`, except the API
Secret, which also contains `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
`PATIENT_KEY_INSTALLATION_ID`, `PATIENT_KEY_VERSION`, and
`PATIENT_KEY_SECRET_BASE64`. Keep each workload's values in a separate private
input file:

```sh
kubectl create secret generic open-triage-api-database \
  --namespace open-triage \
  --from-env-file=/private/path/open-triage-api.env
kubectl create secret generic open-triage-migration-database --namespace open-triage \
  --from-env-file=/private/path/open-triage-migration.env
kubectl create secret generic open-triage-analytics-projector-database --namespace open-triage \
  --from-env-file=/private/path/open-triage-analytics-projector.env
kubectl create secret generic open-triage-analytics-health-database --namespace open-triage \
  --from-env-file=/private/path/open-triage-analytics-health.env
kubectl create secret generic open-triage-retention-database --namespace open-triage \
  --from-env-file=/private/path/open-triage-retention.env
```

Install or upgrade the workloads without passing secret values to Helm:

```sh
helm upgrade --install open-triage ./deploy/helm/open-triage \
  --values ./deploy/helm/open-triage/demo-reference.values.yaml \
  --namespace open-triage --create-namespace
```

The committed demo reference values contain no credentials. They preserve the
cluster-owned `ghcr-pull` image pull Secret, `open-triage-tls` certificate, and
workload database Secrets during repeatable upgrades.

Helm runs a forward-only migration Job before each install or upgrade. The Job
reads `DATABASE_URL` only from the migration Secret and must succeed before Helm
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

To use different cluster-owned Secrets, set the `existingSecret` field under
each `secrets` workload. Helm-managed Secrets remain available by clearing the
corresponding field and supplying that workload's values privately. Set
`migration.enabled=false` when managing its Secret through Helm and arrange a
separate pre-rollout migration mechanism: a Helm hook cannot consume a Secret
that the same release has not created yet. Never point two workload entries at
the same Secret.

Set `web.replicas` and `api.replicas` to `3` when the cluster has three worker
nodes. The current defaults are deliberately one replica for a one-node demo.
