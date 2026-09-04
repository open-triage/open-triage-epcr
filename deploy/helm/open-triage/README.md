# OpenTriage demo chart

This chart deploys the static web frontend, NestJS API, and analytics CronJobs.
PostgreSQL remains in Supabase Free; the chart only stores its connection details
as Kubernetes Secrets.

Build the web image with the public API hostname embedded at build time:

```sh
docker build -f deploy/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL=https://api.opentriage.org \
  -t ghcr.io/open-triage/open-triage-web:demo .
docker build -f deploy/docker/api.Dockerfile \
  -t ghcr.io/open-triage/open-triage-api:demo .
```

Create a private `values.demo.yaml` from `values.yaml`, keep the configured
`demo.opentriage.org` and `api.opentriage.org` hostnames, set the five `secrets`
values, and then install:

```sh
helm upgrade --install open-triage ./deploy/helm/open-triage \
  --namespace open-triage --create-namespace \
  --values deploy/helm/values.demo.yaml
```

Set `web.replicas` and `api.replicas` to `3` when the cluster has three worker
nodes. The current defaults are deliberately one replica for a one-node demo.
