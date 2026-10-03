# Production installation on Kubernetes and Tanzu

This procedure starts a database-backed production web/API installation using
built containers and Helm. Run commands from a reviewed release checkout on a
trusted administration host. Local `npm run dev`, Docker Desktop, Supabase CLI,
and fixture credentials belong to [local development](local-development.md).
Do not use the hosted demo values for a production installation.

## 1. Identify and prepare the platform

If you do not know which Tanzu product you have, ask the platform administrator
which row applies and request the workload cluster name, access method, supported
CLI versions, namespace permissions, registry, ingress class, and database endpoint.
Product names alone do not establish compatible versions.

| What the platform administrator uses | Cluster access path |
| --- | --- |
| vSphere Client, Supervisor, vSphere Kubernetes Service (VKS), or older vSphere with Tanzu | Supervisor login with the vSphere `kubectl` plugin; select the guest/workload cluster context |
| Standalone Tanzu Kubernetes Grid (TKG), with a management cluster | Tanzu CLI retrieves a workload cluster kubeconfig |
| Tanzu Kubernetes Grid Integrated Edition (TKGI), Ops Manager/BOSH | TKGI CLI retrieves cluster credentials |
| Another Kubernetes service | Its supported kubeconfig/login procedure |

Applications belong on a **workload cluster**, not the Supervisor or TKG management
cluster. Use the platform's supported cluster creation workflow rather than copying
cluster resource manifests from another Tanzu edition or release.

For vSphere/VKS, the platform administrator must complete these system prerequisites:

1. Configure the licensed Supervisor and its supported networking/load-balancer
   integration. Reserve node, service and ingress address ranges and load-balancer
   VIPs; verify routes and firewall rules from users, the administration host and
   worker nodes. Provide working forward DNS and synchronized NTP.
2. Create/assign a Supervisor namespace, administrators, capacity quotas, supported
   VM classes, and storage policies. Publish the approved Kubernetes OS/release
   images through the configured content library. Use supported combinations of
   vCenter, Supervisor/VKS, VM hardware and Kubernetes versions.
3. Provision a production workload cluster with a supported control plane and at
   least three workers across appropriate failure domains. These Dockerfiles target
   Linux; build and validate images for the worker architecture (commonly amd64).
4. Validate node readiness, CoreDNS, CSI/storage health and ingress LoadBalancer
   reachability before installing the application. OpenTriage's chart is stateless
   and creates no PostgreSQL service or PVC. Database and registry storage,
   replication and backups are separate platform responsibilities.
5. Make the registry reachable from every node. If Harbor uses a private CA,
   install its CA using the platform's supported node/container-runtime trust
   procedure; an image pull Secret supplies authentication, not CA trust.

In vCenter 8, Supervisor settings are under Workload Management; vCenter 9 uses
Supervisor Management. Broadcom documents [Supervisor setup prerequisites and
storage policies](https://knowledge.broadcom.com/external/article/423594/error-cant-provision-vm-for-clusteragent.html),
[DNS/NTP and network failure modes](https://knowledge.broadcom.com/external/article/323411/common-issues-with-a-vsphere-with-tanzu.html),
and [VM class compatibility](https://knowledge.broadcom.com/external/article/456622/vks-worker-nodes-stuck-in-provisioning-s.html).

Install Node.js 22+, Helm, and a cluster-compatible `kubectl` on the administration
host. Install the matching vSphere plugin, Tanzu CLI, or TKGI CLI where applicable.
The preparation/deployment helpers use Node's standard library: they do not need
`npm ci`. Builders additionally need Docker/BuildKit; the SQL setup example needs
`psql` on a trusted database administration host.

Examples of access commands (substitute your platform's actual names):

```sh
# VKS / vSphere with Tanzu: authenticate to Supervisor, requesting workload access.
kubectl vsphere login --server SUPERVISOR_ADDRESS --vsphere-username YOUR_ACCOUNT \
  --tanzu-kubernetes-cluster-namespace SUPERVISOR_NAMESPACE \
  --tanzu-kubernetes-cluster-name WORKLOAD_CLUSTER

# Standalone TKG: authenticate as directed by the platform, then retrieve access.
tanzu cluster kubeconfig get WORKLOAD_CLUSTER

# TKGI: log in to its API first using the platform's endpoint/CA instructions.
tkgi get-credentials WORKLOAD_CLUSTER

kubectl config get-contexts
```

Do not bypass certificate verification. Use the context returned by your supported
login procedure, and confirm it points to the workload cluster. See Broadcom's
[vSphere context guidance](https://knowledge.broadcom.com/external/article/435399/troubleshooting-kubectl-vsphere-contexts.html),
[TKG kubeconfig/session guidance](https://knowledge.broadcom.com/external/article/434222/error-you-must-be-logged-in-to-the-serve.html),
and [TKGI credential guidance](https://knowledge.broadcom.com/external/article/396843).

Keep these variables in the administration shell for the remaining examples:

```sh
export OT_CONTEXT=YOUR_WORKLOAD_CONTEXT
export OT_NAMESPACE=open-triage
export OT_PRIVATE=/private/open-triage
umask 077
mkdir -p "$OT_PRIVATE"
chmod 700 "$OT_PRIVATE"
kubectl --context "$OT_CONTEXT" get nodes
kubectl --context "$OT_CONTEXT" get pods -n kube-system
kubectl --context "$OT_CONTEXT" create namespace "$OT_NAMESPACE"
```

For an existing namespace, inspect it instead of creating it again. Have the
platform administrator enforce its supported Restricted Pod Security policy
(pinned to the cluster's supported version) and grant namespaced Helm/RBAC access.
The web, API and jobs use non-root UIDs, drop all capabilities, disable privilege
escalation and service-account token mounting, and use RuntimeDefault seccomp.
These settings follow [Kubernetes Restricted policy](https://kubernetes.io/docs/concepts/security/pod-security-standards/).

## 2. Prepare PostgreSQL, ingress, DNS and TLS

Provide a backed-up PostgreSQL 15+ instance reachable from workload nodes/pods.
The migration credential must own the application schemas and have permissions
required by the existing migrations, including portable role/extension creation.
Login provisioning requires `CREATEROLE` and permission to grant those roles;
have a DBA perform it if your migration identity lacks that authority. Never give
these privileges to the runtime API identity. Use a direct or session-mode
connection with supported startup options for maintenance; verify pooler routing,
role selection and TLS with the DBA. See [workload credentials](database-workload-credentials.md).

Use the provider's approved TLS/CA configuration and certificate verification;
percent-encode reserved characters in URL credentials. Confirm DNS resolution and
database connectivity from inside the workload cluster, not just the bastion.
Budget database connections across API replicas, overlapping rolling updates and
jobs; the prepared API login's limit is 20 connections across that login.

Install your platform-supported Contour/Envoy package or an approved nginx ingress
controller. Confirm its pods are ready, its LoadBalancer has a reachable address,
and its **IngressClass exists**. The reference uses class `contour`; substitute the
actual package-supported class. Create DNS records for the web and API names
pointing to the ingress address. Use two names under the same registrable domain,
such as `epcr.your-agency.org` and `api.epcr.your-agency.org`; cross-site hosting
breaks the application's Strict SameSite session cookies.

```sh
kubectl --context "$OT_CONTEXT" get ingressclasses
kubectl --context "$OT_CONTEXT" get services -A
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" create secret tls open-triage-tls \
  --cert="$OT_PRIVATE/fullchain.pem" --key="$OT_PRIVATE/tls.key"
```

Supply a certificate covering both hosts with a trusted full chain. For internal
PKI, install browser/device trust as well. A platform certificate manager may own
this Secret instead; wait for issuance before preflight. The chart redirects HTTP
to HTTPS using controller-specific annotations. Contour does not implement nginx's
authentication rate-limit annotations; set up any additional edge network limits
through the platform. API credential throttling remains enabled. See
[Contour annotation support](https://projectcontour.io/docs/main/config/annotations/)
and [authentication throttling](authentication-throttling.md).

## 3. Build and publish the release images

Use a reviewed commit identifier as an immutable registry tag. Example variables
below are placeholders; replace them before building or copying values:

```sh
export OT_REGISTRY=harbor.your-agency.org/open-triage
export OT_RELEASE=$(git rev-parse HEAD)
export OT_API_ORIGIN=https://api.epcr.your-agency.org
docker login harbor.your-agency.org
docker build -f deploy/docker/api.Dockerfile -t "$OT_REGISTRY/api:$OT_RELEASE" .
docker build -f deploy/docker/web.Dockerfile \
  --build-arg NEXT_PUBLIC_API_URL="$OT_API_ORIGIN" \
  --build-arg OPEN_TRIAGE_BUILD_SHA="$OT_RELEASE" \
  -t "$OT_REGISTRY/web:$OT_RELEASE" .
docker push "$OT_REGISTRY/api:$OT_RELEASE"
docker push "$OT_REGISTRY/web:$OT_RELEASE"
```

The API hostname is compiled into the web image; changing Helm values does not
rewrite it. Keep `NEXT_PUBLIC_USE_LOCAL_DEMO_SESSION=false` (the build default).
Configure Harbor's immutable tags, or pin the resulting image digests in values.
Chart 0.2.0 needs the rebuilt web image, which listens on 8080 using
[unprivileged nginx](https://github.com/nginx/docker-nginx-unprivileged).
Earlier images listening on port 80 are incompatible.

Create `registry-pull` using a read-only Harbor robot account's protected Docker
config file; use a file prepared by your secret manager rather than putting a
password on the command line:

```sh
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" create secret generic registry-pull \
  --type=kubernetes.io/dockerconfigjson \
  --from-file=.dockerconfigjson="$OT_PRIVATE/registry-config.json"
```

## 4. Generate and install private credentials once

On a **new** installation, use your secret manager/editor to create
`$OT_PRIVATE/migration-input.env`, containing exactly one unquoted line:
`DATABASE_URL=<percent-encoded-postgresql-url>`. Do not source it or paste its
contents into history. Then generate the installation's private files:

```sh
npm run prepare:kubernetes -- \
  --migration-env "$OT_PRIVATE/migration-input.env" \
  --output-dir "$OT_PRIVATE/generated"
```

The helper generates five distinct workload logins/passwords, separate 32-byte
patient/authentication/offline-recovery keys, and an installation UUID. It preserves
database routing/TLS options, adds each workload's portable role, writes mode-600
files under a mode-700 directory, and refuses overwrites. Import the files into
your backed-up secret manager. Retain the installation keys across upgrades;
regenerating them can break patient-key continuity and offline recovery.

| Secret name | Generated input | Usage |
| --- | --- | --- |
| `open-triage-migration-database` | `open-triage-migration.env` | Schema owner; hook and temporary setup pod only |
| `open-triage-api-database` | `open-triage-api.env` | API and review worker; API runtime role and installation keys |
| `open-triage-analytics-projector-database` | `open-triage-analytics-projector.env` | Projection writer |
| `open-triage-analytics-health-database` | `open-triage-analytics-health.env` | Projection monitor |
| `open-triage-retention-database` | `open-triage-retention.env` | Retention workload |
| `open-triage-operational-audit-database` | `open-triage-operational-audit.env` | Separate operational audit gateway; not mounted by this chart |
| `open-triage-workload-bootstrap` | `open-triage-workload-bootstrap.env` | Temporary login provisioner; delete after setup |

Create the Secrets outside Helm, or synchronize them with your platform's secret
manager integration. Start with the two maintenance Secrets:

```sh
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" create secret generic \
  open-triage-migration-database \
  --from-env-file="$OT_PRIVATE/generated/open-triage-migration.env"
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" create secret generic \
  open-triage-workload-bootstrap \
  --from-env-file="$OT_PRIVATE/generated/open-triage-workload-bootstrap.env"
```

Create the five runtime/audit Secrets before preflight:

```sh
for OT_WORKLOAD in api analytics-projector analytics-health retention operational-audit; do
  kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" create secret generic \
    "open-triage-$OT_WORKLOAD-database" \
    --from-env-file="$OT_PRIVATE/generated/open-triage-$OT_WORKLOAD.env"
done
```

Existing installations reuse their existing Secrets and logins; do not rerun generation or
owner bootstrap. Follow the [rotation runbook](database-workload-credentials.md)
for deliberate credential changes. Kubernetes Secrets require appropriate RBAC,
etcd encryption and protected backups; base64 is not encryption.

## 5. Initialize the database and owner

Copy `deploy/kubernetes/installation-setup.pod.yaml` into `$OT_PRIVATE`, and replace
its image with the approved API release image from step 3. This temporary pod uses
the migration credential and bootstrap login inputs. Create both Secrets first;
adding an environment Secret later does not update an already-started pod.

```sh
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" apply \
  -f "$OT_PRIVATE/installation-setup.pod.yaml"
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" wait \
  --for=condition=Ready pod/open-triage-installation-setup --timeout=180s
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" exec open-triage-installation-setup -- \
  npm run migrate:runtime -w @open-triage/database
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" exec open-triage-installation-setup -- \
  npm run provision:workload-logins -w @open-triage/database
```

Migration creates the portable roles before provisioning grants them to distinct
installation logins. If privilege is delegated to a DBA, have the DBA run this
provisioner with the protected bootstrap inputs instead of broadening runtime
grants. Validate connectivity using each runtime login/role before rollout.

Create the real organization with a retained UUID, agency name and IANA timezone
using the trusted DBA connection. For example, save this as a reviewed private
`organization.sql`, replace the example values, and execute with `psql`'s approved
service/credential configuration and `ON_ERROR_STOP=1`:

```sql
insert into app_identity.organization (id, name, deployment_timezone)
values ('REPLACE_WITH_ORGANIZATION_UUID', 'Your agency', 'Europe/Stockholm')
on conflict (id) do nothing;
```

Verify the existing row when rerunning; this does not update organization settings.
The ordinary defaults are ten-year clinical retention and fourteen-hour shift
sessions. Bootstrap the owner with an interactive, non-echoed temporary password:

```sh
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" exec -it open-triage-installation-setup -- \
  npm run identity:account:runtime -w @open-triage/api -- bootstrap-owner \
  --organization-id YOUR_ORGANIZATION_UUID --username YOUR_OWNER_USERNAME \
  --display-name 'Installation owner' --operator-id YOUR_CHANGE_RECORD
```

The runtime command uses compiled code and needs no build tools in the container.
Owner bootstrap is one-time; use [identity recovery](identity-recovery.md) for an
existing owner. The owner changes the temporary password at first sign-in. Do not
run `bootstrap:synthetic`, the development reset, or use demo fixture credentials
to commission production.

```sh
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" delete pod open-triage-installation-setup
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" delete secret open-triage-workload-bootstrap
```

The setup pod also has a one-hour deadline; still delete it promptly. Keep the
migration Secret for subsequent migration hooks, accessible only to authorized
operators. Preserve bootstrap inputs in the secret manager for deliberate rotation,
then remove disposable local copies according to your organization's policy.

## 6. Preflight and start the production workloads

```sh
cp deploy/helm/open-triage/production-reference.values.yaml "$OT_PRIVATE/production.values.yaml"
```

Edit both hosts, TLS hosts, image repositories/tags or digests, ingress class/controller,
and resource sizing. The sample uses two replicas and RollingUpdate, preserves
cluster-owned Secrets, enables the migration gate, and disables synthetic bootstrap.
For nginx choose `controller: nginx` and its actual class; nginx edge auth limits
can then be enabled. Verify `api.trustProxyHops` against the actual trusted proxy
chain; never increase it speculatively. Plan capacity for rollout surge and CronJobs.

```sh
npm run deploy:kubernetes -- --context "$OT_CONTEXT" --namespace "$OT_NAMESPACE" \
  --values "$OT_PRIVATE/production.values.yaml"
npm run deploy:kubernetes -- --context "$OT_CONTEXT" --namespace "$OT_NAMESPACE" \
  --values "$OT_PRIVATE/production.values.yaml" --apply
```

The first command does not change cluster resources. It validates chart rendering,
production hosts/images, separate workload Secret contracts and nonempty required
keys, TLS and pull Secret types, ingress class, Restricted settings, deployment
RBAC and server-side admission. It never prints Secret contents. The second runs
`helm upgrade --install` with an explicit context and waits up to fifteen minutes
for jobs and workload readiness. Every helper Kubernetes call specifies context
and namespace; it does not switch your global context.

Preflight does **not** verify registry reachability, certificate SAN/expiry, database
passwords/privileges, actual failure-domain placement, or clinical configuration.
Verify these through platform checks and the following acceptance steps.
Migrations run before rollout, record checksums, and are committed individually.
Successfully committed migrations survive a later rollout failure; Helm rollback
does not undo them. Do not use automatic application rollback as database recovery.

## 7. Verify and commission before clinical use

```sh
kubectl --context "$OT_CONTEXT" -n "$OT_NAMESPACE" get pods,deployments,jobs,cronjobs,ingresses
curl --fail --show-error https://api.epcr.your-agency.org/api/health
curl --fail --show-error --head https://epcr.your-agency.org/
```

Use your actual hosts. Verify both HTTP hosts redirect to HTTPS, the certificate
chain and names validate, the web build reaches the expected API, owner sign-in
and password change work, and a subsequent authenticated request succeeds.
Confirm analytics/review jobs complete and freshness monitoring is active.

**Fresh-database commissioning limitation:** schema/catalog import and owner setup
do not create an approved agency clinical configuration. The current application
requires an existing published form/validation/catalog baseline for configuration
authoring; this runbook does not supply a first-baseline production importer.
Arrange an approved configuration installation with the application maintainer
before accepting patient records. Publish/activate the reviewed configuration,
configure real agency demographics, units, users and assignments, and complete
the organization's clinical acceptance checks. Health and owner login alone do
not establish clinical readiness. Synthetic bootstrap is not a substitute.

Set up database PITR, key backup/recovery and tested restores using
[database operations](database-operations.md),
[protected offline storage](../protected-offline-clinical-storage.md), and
[analytics operations](analytics-projection.md).
The chart schedules synthetic expiry only; separately schedule and monitor
ordinary clinical [retention](retention.md) and
[feedback diagnostic retention](feedback-diagnostic-retention.md).
Connect operational audit credentials only to their authorized gateway.

## Troubleshooting and subsequent releases

Always keep `--context "$OT_CONTEXT" -n "$OT_NAMESPACE"` on investigation commands.

| Symptom | First checks |
| --- | --- |
| Login/kubeconfig expired; Forbidden | Repeat supported platform login; check workload context and namespace RBAC. TKG credentials can expire. |
| Pending pods | `get events --sort-by=.metadata.creationTimestamp`, quotas, node capacity and admission policy; include rollout surge/job resources. |
| ImagePullBackOff | Inspect pod events; tag/digest, robot permissions, pull Secret, node DNS/network and Harbor CA trust. |
| Migration hook fails | `logs job/open-triage-migration`; database connectivity/role/extension authority, migration checksum and timeouts. Resolve the cause before retrying. Protect logs. |
| Secret preparation/deployment stops | Check helper `--help`, private directory permissions, existing file names, required Secret key names and types. Do not overwrite installation keys. |
| HTTPS 404/503 | IngressClass/controller, Envoy/controller service endpoints, API/web readiness, DNS/LB address, TLS Secret and port mapping. |
| Browser sign-in fails | Web image's compiled API URL, `WEB_ORIGIN`, same-site DNS names, TLS/browser trust and proxy hop setting. |

For detailed render/admission errors, create a private file with `helm template`
using your values, then inspect it or run `kubectl apply --dry-run=server`.
Retained hook Jobs are immutable: give the dry-run hook a temporary name, as the
helper does, rather than modifying the completed migration Job. Do not apply the
rendered file as an alternative rollout; use Helm so its migration gate runs.

For an upgrade, review migrations and backups, publish both matching images,
update private values, then rerun preflight and `--apply`. Reuse existing credentials
and installation keys. Inspect `helm status open-triage --kube-context "$OT_CONTEXT"
--namespace "$OT_NAMESPACE"` and deployment events on failure. Application rollback
is appropriate only after confirming the previous image is compatible with the
committed schema. Test upgrades and restoration in staging before production.
