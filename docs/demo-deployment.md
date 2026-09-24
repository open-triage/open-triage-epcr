# Demo deployment operations

The `Demo validation` GitHub Actions workflow is the only automated path to the
DigitalOcean Kubernetes (DOKS) demo. Every push to `main` validates the
application, PostgreSQL integration, deployable web artifact, and Helm chart.
Only the exact merge commit of one reviewed or owner-authorized pull request into
`main`, with authorization for that pull request's final head commit, may publish immutable
API and web `linux/amd64` images, run the explicit database-preparation phase,
and atomically deploy the exact image tags recorded in that run's artifact. A direct
push still produces diagnostics but cannot publish or deploy. Missing,
ambiguous, mismatched, or unavailable GitHub provenance fails closed before the
workflow authenticates to the registry or cluster. Deployment runs are
serialized and are never cancelled by a newer run.

After the Helm rollout, the same job verifies the frontend certificate and
public Ingress routes, API health, synthetic login, and an authenticated
assigned-calls read. A failed smoke check fails the workflow. Smoke verification
is after Helm, however, so it does not itself activate Helm's atomic rollback.

## Prerequisites and deployment targets

The `demo` GitHub environment must allow deployments from `main` and define:

- secret `DIGITALOCEAN_ACCESS_TOKEN`, restricted in DigitalOcean to the demo
  cluster resources required by `doctl`;
- variable `DOKS_CLUSTER_NAME`, naming the existing demo cluster.
- variables `DEMO_DATABASE_EXPECTED_HOST` and `DEMO_DATABASE_PROJECT_REF`,
  identifying the one disposable Supabase project the preparation phase may
  target;
- variable `DEMO_DATABASE_PREPARE_MODE`, normally `migrate`. An intentional
  reset additionally requires `DEMO_DATABASE_RESET_CONFIRMATION` with the exact
  value documented in the
  [database rollout runbook](./runbooks/disposable-demo-database-rollout.md).

`GITHUB_TOKEN` is supplied by Actions and receives `packages: write` only in the
two image-publishing jobs. The deployment job has only `contents: read`. It
exchanges the DigitalOcean token for a kubeconfig that expires after ten minutes
and stores it only on the ephemeral runner. Do not add a kubeconfig or cluster
certificate to GitHub secrets.

Before the first deployment, operators must provide:

- an existing DOKS cluster with enough capacity for the chart's resource
  requests, an `nginx` IngressClass, and HTTPS termination for both public
  hosts; its ingress-nginx controller ConfigMap must set `hsts: "true"`,
  `hsts-max-age: "31536000"`, `hsts-include-subdomains: "true"`, and
  `hsts-preload: "false"`;
- DNS for `demo.opentriage.org` and `api.demo.opentriage.org` pointing to that
  Ingress;
- access from the cluster to
  `ghcr.io/open-triage/open-triage-{api,web}`. If the packages are private,
  provision a pull credential outside the workflow and expose it through the
  chart's `imagePullSecrets` value or the namespace's default service account;
- the `open-triage` namespace and its cluster-owned API, migration, analytics
  projector, analytics health, retention, and operational-audit database
  Secrets. Although Helm is invoked with
  `--create-namespace`, a usable first deployment requires operators to create
  the namespace and Secrets in advance so the explicit preparation phase can
  use its dedicated Secret before Helm-managed resources exist. Follow the
  [chart instructions](../deploy/helm/open-triage/README.md) for the required
  keys and safe creation procedure;
- the external PostgreSQL 15-or-newer/Supabase demo database referenced by the
  workload Secrets, initialized only with fictional demo data.

The read-only capacity preflight calculates each scheduled active pod using
Kubernetes scheduling semantics: concurrent application containers are summed,
sequential init containers contribute their peak, restartable init sidecars
remain part of the running total, and pod overhead is included. For a deployment
whose live strategy is explicitly `Recreate`, it then
credits only the requests of pods in the target namespace that match that
deployment's selector, because Kubernetes removes those pods before scheduling
their replacements. It does not credit `RollingUpdate` deployments, unmatched
pods, terminal pods, or workloads in another namespace.

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

Independent review and explicit owner authorization are both supported permanently.
Set the repository variable `DEMO_DEPLOYMENT_OWNER_LOGIN` to the designated owner's
GitHub login. Before merging, that owner can comment exactly
`authorize-demo-deployment <full PR head SHA>` on the PR. The workflow verifies
that the author is the configured human account and still has repository admin
permission. An authorization for an older head, a comment edited after merge,
or a later `revoke-demo-deployment <full PR head SHA>` comment does not authorize
deployment. Setting the variable alone does not authorize any commit.

Run `Demo validation` with **Run workflow** and supply the full 40-character
SHA of the current `main` tip. The workflow rejects older or non-main commits,
direct-push commits, commits without current review or owner authorization, and
revisions without an earlier push run whose successful validation and
provenance jobs name that exact SHA. It then repeats validation, republishes the
immutable images, and deploys only the image identities recorded by that run.

Helm uses `--atomic`, `--wait`, and a ten-minute timeout. Database preparation
must complete before Helm starts; failed readiness probes or rollouts fail the
workflow and restore the prior Helm release. Database migrations are
forward-only and remain committed as documented in the chart README. Both one-replica Deployments use `Recreate`, so
the one-node demo may be briefly unavailable while pods are replaced.

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
- **Database preparation failure:** the failing migration transaction is rolled
  back and Helm never starts. Inspect the separately retained preparation Job
  and artifact, fix the migration with a new commit, and redeploy. Never edit an
  already applied migration or attempt to reverse it manually.
- **Rollout or readiness failure:** Helm removes failed new resources and
  restores the prior Helm release. Any migration that completed before the
  rollout remains committed. Diagnose whether the prior application is
  compatible with that schema before treating workload rollback as recovery.
- **Public smoke failure:** the Helm release may already be installed
  successfully. Check certificates, DNS, Ingress routing, API health, and the
  synthetic login journey. A manual rerun of the failed commit is safe after an
  infrastructure repair. If application code must change, ship a forward fix on
  `main`.

Manual deployment cannot select an older SHA because database migrations are
forward-only. Ship a forward fix when application changes are required.
Preserve the failed workflow logs
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
`scripts/require-demo-provenance.mjs` and `deploy/helm/open-triage/**` with
CODEOWNERS or an equivalent review rule. The deployment job should remain
assigned to the protected `demo` environment; optionally add a required
reviewer there when unattended deployment is not appropriate.

These code-level checks limit accidental and ordinary unauthorized publication;
they cannot defend against a repository writer who deliberately changes or
removes the workflow guard and pushes that change. Server-side branch
protection, protected environments, and restricted workflow changes remain the
security boundary against a malicious writer.
