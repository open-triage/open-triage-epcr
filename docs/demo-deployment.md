# Demo deployment operations

The `Demo validation` GitHub Actions workflow is the only automated path to the
DigitalOcean Kubernetes (DOKS) demo. A push to `main` validates the application,
PostgreSQL integration, deployable web artifact, and Helm chart; publishes
immutable API and web `linux/amd64` images; runs the forward-only migration
hook; and atomically deploys the exact image tags recorded in that run's
artifact. Deployment runs are serialized and are never cancelled by a newer
run.

After the Helm rollout, the same job verifies the frontend certificate and
public Ingress routes, API health, synthetic login, and an authenticated
assigned-calls read. A failed smoke check fails the workflow. Smoke verification
is after Helm, however, so it does not itself activate Helm's atomic rollback.

## Prerequisites and deployment targets

The `demo` GitHub environment must allow deployments from `main` and define:

- secret `DIGITALOCEAN_ACCESS_TOKEN`, restricted in DigitalOcean to the demo
  cluster resources required by `doctl`;
- variable `DOKS_CLUSTER_NAME`, naming the existing demo cluster.

`GITHUB_TOKEN` is supplied by Actions and receives `packages: write` only in the
two image-publishing jobs. The deployment job has only `contents: read`. It
exchanges the DigitalOcean token for a kubeconfig that expires after ten minutes
and stores it only on the ephemeral runner. Do not add a kubeconfig or cluster
certificate to GitHub secrets.

Before the first deployment, operators must provide:

- an existing DOKS cluster with enough capacity for the chart's resource
  requests, an `nginx` IngressClass, and HTTPS termination for both public
  hosts;
- DNS for `demo.opentriage.org` and `api.demo.opentriage.org` pointing to that
  Ingress;
- access from the cluster to
  `ghcr.io/open-triage/open-triage-{api,web}`. If the packages are private,
  provision a pull credential outside the workflow and expose it through the
  chart's `imagePullSecrets` value or the namespace's default service account;
- the `open-triage` namespace and its cluster-owned
  `open-triage-database` Secret. Although Helm is invoked with
  `--create-namespace`, a usable first deployment requires operators to create
  the namespace and Secret in advance because the pre-install migration hook
  needs the Secret before Helm-managed resources exist. Follow the
  [chart instructions](../deploy/helm/open-triage/README.md) for the required
  keys and safe creation procedure;
- the external PostgreSQL 15-or-newer/Supabase demo database referenced by the
  Secret, initialized only with fictional demo data.

The fixed automated targets are Helm release `open-triage`, namespace
`open-triage`, web host `https://demo.opentriage.org`, and API host
`https://api.demo.opentriage.org`. Changing any of them requires a reviewed
workflow or chart change; they are not workflow inputs.

The committed, non-secret
`deploy/helm/open-triage/demo-reference.values.yaml` file also pins the existing
`ghcr-pull` image pull Secret and `open-triage-tls` Ingress certificate. Keep
those cluster-owned Secrets in place. The workflow passes this file to Helm
validation and every automated upgrade so a release cannot silently discard
private-registry access or public TLS configuration.

## Manual redeployment

Run `Demo validation` with **Run workflow** and supply the full 40-character
SHA of a commit reachable from `main`. The workflow rejects non-main commits,
repeats validation, republishes the immutable images, and deploys only the
image identities recorded by that run.

Helm uses `--atomic`, `--wait`, and a ten-minute timeout. Failed migrations,
readiness probes, or rollouts fail the workflow and restore the prior Helm
release. Database migrations are forward-only and remain committed as
documented in the chart README. Both one-replica Deployments use `Recreate`, so
the one-node demo may be briefly unavailable while pods are replaced.

Smoke verification logs only named pass/fail stages and HTTP status codes. It
does not print bearer tokens, login responses, or assigned-call response bodies.
Both public URLs must use HTTPS; Node's normal TLS verification rejects an
expired, untrusted, or hostname-mismatched certificate.

## Failure recovery and rollback

Start with the failed workflow job, then inspect the release without printing
Secret values:

```sh
helm status open-triage --namespace open-triage
helm history open-triage --namespace open-triage
kubectl get pods,jobs --namespace open-triage
```

- **Validation or image publication failure:** nothing is deployed. Correct the
  failure on `main`; the next push performs the complete validation and release
  sequence again.
- **Migration failure:** the migration's transaction is rolled back, the Helm
  pre-upgrade hook stops the release, and `--atomic` retains the prior workloads.
  Fix the migration with a new commit and redeploy. Never edit an already applied
  migration or attempt to reverse it manually.
- **Rollout or readiness failure:** Helm removes failed new resources and
  restores the prior Helm release. Any migration that completed before the
  rollout remains committed. Diagnose whether the prior application is
  compatible with that schema before treating workload rollback as recovery.
- **Public smoke failure:** the Helm release may already be installed
  successfully. Check certificates, DNS, Ingress routing, API health, and the
  synthetic login journey. A manual rerun of the failed commit is safe after an
  infrastructure repair. If application code must change, ship a forward fix on
  `main`.

An operator may redeploy an earlier full SHA reachable from `main`, but this
rolls back application images only—not database migrations. Prefer a forward
fix whenever a newer migration has committed. Preserve the failed workflow logs
and Helm history for diagnosis, but never copy login responses, bearer tokens,
kubeconfigs, or Secret contents into tickets or chat.

## Synthetic-data boundary

This deployment is a public, synthetic-data-only demonstration. It is not a
production environment, is not approved for clinical use, and must never
receive protected health information or other real patient, clinician, agency,
or dispatch data. The migration hook deliberately does not seed data. Provision
the fictional installation once with the explicit `bootstrap:synthetic` command
in the [chart instructions](../deploy/helm/open-triage/README.md).

The demo's hard-coded credentials, in-memory sessions, and incomplete endpoint
authorization are tracked in
[#190, Harden API authentication and authorization for production](https://github.com/open-triage/open-triage-epcr/issues/190).
Until that work and a separate production security review are complete, this
workflow and chart must not be repurposed for real clinical data.

## Deferred production and zero-downtime work

Zero-downtime deployments are a future requirement, not a property of this
demo. The current chart intentionally uses one replica and `Recreate` for both
Deployments, so an upgrade can interrupt the web and API services. Simply
increasing `replicas` does not remove that limitation while `Recreate` remains
configured.

A production rollout design must, at minimum, introduce tested `RollingUpdate`
settings with multiple replicas, enforce disruption availability, make sessions
durable across API replicas as required by issue #190, and use backward-
compatible expand/contract migrations so old and new application versions can
run against the schema during a rollout. It must also validate capacity,
readiness behavior, ingress draining, rollback compatibility, observability,
backup/restore, credential rotation, and the production authentication and
authorization boundary before claiming zero downtime.

## Required repository protection

Protect `main` in GitHub and require **Required / Demo validation gate** before
merge. Require pull requests, block force pushes and branch deletion, dismiss
stale approvals when new commits are pushed, and require branches to be up to
date. Restrict changes to `.github/workflows/demo-validation.yml` and
`deploy/helm/open-triage/**` with CODEOWNERS or an equivalent review rule. The
deployment job should remain assigned to the protected `demo` environment;
optionally add a required reviewer there when unattended deployment is not
appropriate.
