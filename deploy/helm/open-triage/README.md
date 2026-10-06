# OpenTriage Kubernetes chart

This chart deploys the static web frontend, NestJS API, and analytics CronJobs.
PostgreSQL 15+ is provided separately; the chart does not deploy a database.
For production, including Tanzu, start with the
[production installation runbook](../../../docs/runbooks/kubernetes-production.md)
and `production-reference.values.yaml`. Defaults below retain the hosted demo's
single-replica sizing and must be overridden for production.

By default the chart references separate
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
Secret, which also contains
`PATIENT_KEY_INSTALLATION_ID`, `PATIENT_KEY_VERSION`, and
`PATIENT_KEY_SECRET_BASE64`, `AUTH_RATE_LIMIT_SECRET_BASE64`,
`OFFLINE_RECOVERY_KEY_VERSION`, and `OFFLINE_RECOVERY_SECRET_BASE64`. The
authentication rate-limit secret must be a distinct random value of at least 32
bytes, shared by every API replica. The protected-storage wrapping secret must
also be dedicated to that purpose and backed up according to the offline
recovery runbook. `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are optional for standalone
PostgreSQL. Keep each workload's values in a separate private input file:

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

The optional top-level `nodeSelector` applies to every app workload, including
the migration hook and all CronJobs. It defaults to no placement restriction.
The demo reference values select `doks.digitalocean.com/node-pool: pool-6inz100pf`
so app pods stay on the larger demo pool across upgrades and node replacements.

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

The migration Job applies schema migrations, imports the canonical catalog and
installation definitions from `defines/`, and then seeds any applicable published
configuration. The public demonstration values set
`migration.bootstrapSynthetic=true`, which performs that installation flow before
running the idempotent, insert-only fixture bootstrap and reseeding applicable
definitions. The target organization must
already exist; this creates the `demo` account if missing, with initial password
`opentriagedemo`, and never changes an existing account. For a one-time manual bootstrap, run:

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

The demo retains one web and one API replica on its selected pool. Configure
replicas and rollout strategies for the installation's availability requirements.

Chart 0.2.0 requires the rebuilt, unprivileged web image listening on port 8080;
the Service still exposes port 80. Do not reuse earlier web images listening on 80.
All workloads run with restricted pod security and no mounted service-account
token. Set `web.image.digest` / `api.image.digest` to a `sha256:…` value to pin
images by digest; a digest takes precedence over the tag, including in all jobs.
Choose `ingress.controller: contour` or `nginx` separately from `className`.
Contour requires `ingress.authenticationRateLimit.enabled: false`; configure
any additional edge rate limits through the platform. API authentication throttling
is independent of the ingress controller.
