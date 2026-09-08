# Demo deployment operations

The `Demo validation` workflow is the only automated path to the DOKS demo.
A push to `main` validates the application, database, web artifact, and Helm
chart; publishes immutable API and web `linux/amd64` images; runs the
forward-only migration hook; and atomically deploys the exact image tags from
that run's run-scoped GitHub artifact. After the rollout, the same deployment
job verifies the frontend certificate and public Ingress routes, API health,
synthetic login, and an authenticated assigned-calls read. A failed smoke check
fails the deployment. Deployment runs are serialized.

The `demo` GitHub environment must define:

- secret `DIGITALOCEAN_ACCESS_TOKEN`, restricted in DigitalOcean to the demo
  cluster resources required by `doctl`;
- variable `DOKS_CLUSTER_NAME`, naming the existing demo cluster.

The workflow exchanges the token for a kubeconfig that expires after ten
minutes and stores it only on the ephemeral runner. Do not add a kubeconfig or
cluster certificate to GitHub secrets.

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

## Required repository protection

Protect `main` in GitHub and require **Required / Demo validation gate** before
merge. Require pull requests, block force pushes and branch deletion, dismiss
stale approvals when new commits are pushed, and require branches to be up to
date. Restrict changes to `.github/workflows/demo-validation.yml` and
`deploy/helm/open-triage/**` with CODEOWNERS or an equivalent review rule. The
deployment job should remain assigned to the protected `demo` environment;
optionally add a required reviewer there when unattended deployment is not
appropriate.
