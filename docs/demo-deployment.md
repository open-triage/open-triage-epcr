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

On 9 October 2026, a read-only query of the demo cluster reported Kubernetes
control-plane version **v1.36.3**. This is an observed baseline, not a version pin
in this repository. The regional VKS installation is planned for Kubernetes 1.36;
see the [production runbook](runbooks/kubernetes-production.md) for its platform
assumptions and validation requirements.

## Operator-owned installation configuration

The repository contains reusable chart defaults and
`deploy/helm/open-triage/installation.example.values.yaml`, a fictional example.
Actual node-pool labels, hostnames, TLS and pull-Secret references, ingress
settings, and resource overrides belong in an operator-owned values file.
Changing a node pool does not require a source-code change.

For a new installation:

```sh
mkdir -p deploy/installations
cp deploy/helm/open-triage/installation.example.values.yaml deploy/installations/demo.values.yaml
```

Replace the example hosts and node selector, and set the installation's TLS
Secret names, certificate issuer, pull Secret, workload Secret references and
resource sizing. Set `nodeSelector: {}` to allow any suitable node. The shared
selector applies to the web, API, migration hook and every scheduled app job.
The example's small resource requests are illustrative; verify capacity for
system pods, app pods, overlapping scheduled jobs and migration hooks.
`deploy/installations/` is excluded from Git and Docker build contexts. Store a
backup in your installation's configuration store; a local ignored file alone
is not a backup. Keep credential values in cluster Secrets, not in this file.

The `demo` GitHub environment must allow deployments from `main` and define:

- secret `DIGITALOCEAN_ACCESS_TOKEN`, restricted to the demo cluster resources;
- variable `DOKS_CLUSTER_NAME`, naming the existing demo cluster;
- variable `DEMO_INSTALLATION_VALUES`, containing the completed **non-secret YAML
  values file**. Upload it without shell interpolation:

```sh
gh variable set DEMO_INSTALLATION_VALUES --env demo < deploy/installations/demo.values.yaml
```

Validate a local file before uploading it (use a new output filename each time):

```sh
node scripts/installation-values.mjs --input deploy/installations/demo.values.yaml \
  --output /tmp/validated-installation.values.json
helm lint deploy/helm/open-triage --values /tmp/validated-installation.values.json
```

A main-branch deployment validates the environment configuration before publishing
images and snapshots it as a non-secret Actions artifact with one-day retention.
The web image's API origin and optional `PUBLIC_SITE_HOST`, Helm rollout and
public smoke-test URLs all come from that same snapshot. Missing settings,
example hosts, missing TLS coverage, embedded workload credentials and image
overrides fail validation. Image identities still come exclusively from the
verified image manifest. Pull requests lint and render the fictional example
without access to the demo environment. If the snapshot has expired, rerun the
whole workflow, not just its deployment job. Environment changes apply on the
next full deployment; retrying a failed downstream job reuses its original snapshot.

The automated release and namespace remain `open-triage`. The pipeline receives
`packages: write` only for image publishing; deployment has `contents: read` and
uses a kubeconfig expiring after thirty minutes. Do not store kubeconfigs in
GitHub secrets.

Before deploying, operators must supply a ready cluster with the selected nodes,
working ingress/DNS and certificates for the configured hosts, registry access,
and all referenced database Secrets in the `open-triage` namespace. Follow the
[chart instructions](../deploy/helm/open-triage/README.md) to prepare the existing
external database and Secrets. Credential provisioning is an installation step;
the deployment workflow no longer runs the legacy Secret-conversion script.
An older installation that still needs that conversion must run
`scripts/provision-demo-workload-secrets.sh` explicitly with its current API image
before enabling this workflow; it assumes the historical standard Secret names.

nginx ingress must retain `hsts: "true"`, `hsts-max-age: "31536000"`,
`hsts-include-subdomains: "true"`, and `hsts-preload: "false"` in its controller
ConfigMap. The public smoke check verifies the resulting HTTPS policy.

### Transition from committed demo values

Before merging this workflow change, export the deployed Helm values to the
operator-owned file:

```sh
umask 077
mkdir -p deploy/installations
helm get values open-triage --namespace open-triage --kube-context YOUR_CONTEXT \
  --output yaml > deploy/installations/demo.values.yaml
```

Review the export locally. Remove `api.image` and `web.image` because CI owns
image selection; explicitly add `web.host`, `api.host`, and `publicSite.host`
(if enabled), which older releases inherited from the chart. Preserve the
current node selector, resource requests and Secret references for this transition.
Validate and upload the file as described above **before merging**. Do not paste
credential values into GitHub variables. No fallback to the former committed
configuration exists, so an unconfigured deployment fails before publishing images.
Move to a smaller pool later by editing the installation file, uploading it and
running a full deployment after checking capacity; retiring unused nodes is a
separate operator action.

The optional public one-pager uses `publicSite.host`. Build the web image with
`PUBLIC_SITE_HOST` matching that value when enabling it outside this workflow.
The homepage files remain in `apps/web/public/landing/`; its separate nginx
virtual host serves them without loading the clinical app or its service worker.

## Manual redeployment

Run `Demo validation` with **Run workflow** and supply the full 40-character
SHA of a commit reachable from `main`. The workflow rejects non-main commits,
repeats validation, republishes the immutable images, and deploys only the
image identities recorded by that run.

Helm uses `--atomic`, `--wait`, and a ten-minute timeout. Failed migrations,
readiness probes, or rollouts fail the workflow and restore the prior Helm
release. Database migrations are forward-only and remain committed as
documented in the chart README. Both one-replica Deployments use `Recreate`, so
the demo may be briefly unavailable while pods are replaced.

Smoke verification logs only named pass/fail stages and HTTP status codes. It
does not print bearer tokens, login responses, or assigned-call response bodies.
Both public URLs must use HTTPS; Node's normal TLS verification rejects an
expired, untrusted, or hostname-mismatched certificate.

## Browser security-header policy

The web image emits a restrictive Content Security Policy. Next.js static-export
hydration scripts are authorized by build-generated SHA-256 hashes; the policy
does not permit `unsafe-inline` or `unsafe-eval`. Styles and all other active
content are same-origin, connections are limited to the configured API origin,
framing is denied by both `frame-ancestors 'none'` and `X-Frame-Options: DENY`,
MIME sniffing is disabled, referrers are reduced to their origin on cross-origin
requests, and camera, microphone, and geolocation browser features are disabled.
The API applies the same non-CSP headers and a `default-src 'none'` CSP.

TLS terminates at nginx Ingress, which redirects HTTP and sets HSTS on both
public hosts. The reviewed rollout is one year (`max-age=31536000`) with
`includeSubDomains` enabled and preload disabled. The include-subdomains scope is
limited to descendants of the dedicated `demo.opentriage.org` and
`api.demo.opentriage.org` hosts; it does not cover their sibling or parent hosts.
Preload remains excluded because its persistence and removal process require a
separate inventory and rollback review. ingress-nginx configures HSTS in its
controller ConfigMap rather than through per-Ingress annotations, so any new TLS
terminator must reproduce this exact policy. The deployment smoke test is the
release gate that prevents a controller or environment migration from silently
losing it. Local Next.js and API development stays on HTTP and does not set HSTS.

The post-deployment smoke test rejects either host when CSP, HSTS, MIME-sniffing,
referrer, permissions, or clickjacking protection is missing or weakened. This
makes an ingress migration fail visibly instead of silently losing the policy.

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
or dispatch data. Create its ordinary organization and owner through the same
operator-controlled process as production, then run the explicit
`bootstrap:synthetic` command in the
[chart instructions](../deploy/helm/open-triage/README.md). That command adds only
missing fixture accounts and never repairs or overwrites later administration.

The fixture credentials are supplied to smoke validation as protected workflow
secrets; the public installation endpoint and login form never expose them. This
public environment still requires a separate production security review before
it may be repurposed for real clinical data.

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
