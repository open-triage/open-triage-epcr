# OpenTriage

Browser-based electronic patient care reporting, initially modeled on NEMSIS 3.5.1.

## Workspace

- `apps/web`: Next.js/React progressive web app
- `apps/api`: NestJS API
- `packages/contracts`: shared, framework-independent types and form definitions
- `supabase`: local Supabase configuration and SQL migrations
- `docs`: product requirements, architecture notes, and operational runbooks

The product requirements documents are indexed in
[`docs/prds/README.md`](docs/prds/README.md).

## Start a local development instance

1. Install Node.js 22 or newer, Docker Desktop (or a Docker engine), and the
   [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
2. Run `npm ci`, copy `.env.example` to `.env.local`, and configure the private
   database and installation keys.
3. On a fresh machine, run `supabase start` from the repository root and complete
   the [local database and owner setup](docs/runbooks/local-development.md).
4. Run `npm run dev` from the repository root. `npm run dev:local` is an alias.

Web runs on http://localhost:3000 and the API on http://localhost:3001.
The startup helper loads `.env.local`, keeps its private values in the API
process, checks for occupied ports, and waits for PostgreSQL before launching
the API, analytics watcher, and web app. For the default local database on port
54322, it can start Docker Desktop and resume the existing project database
container, using `docker.exe` on WSL when Linux Docker integration is unavailable.
It confirms API and web readiness and stops the process groups together on exit.
Do not source `.env.local` before launching the web app separately: its API
`PORT=3001` would make Next.js compete with the API. The helper isolates these values;
the runbook also gives the two-process manual procedure.
Run `npm run dev -- --check` to check configuration, ports, and database readiness
without launching the app. See the [local development runbook](docs/runbooks/local-development.md)
for first-time setup, manual startup, and troubleshooting.

API development also starts the analytics projector and the Review worker. Review
processes signed reports in bounded batches, polling every five seconds after the
previous batch finishes. Restart the API development process after changing its
startup scripts. To process a batch manually with `DATABASE_URL` loaded, run
`npm run review:work -w @open-triage/api`.

The NestJS API uses TypeORM with `DATABASE_URL` and requires PostgreSQL 15 or newer.
Supabase SQL migrations remain the single source of truth for schema changes;
TypeORM's `synchronize` option is disabled.

The clinical and analytical database design is documented in
[`docs/database-architecture.md`](docs/database-architecture.md). Schema migrations do not import definitions. Admins explicitly import selected JSON
files from `defines/` in the Catalog, Forms, and Validation editors, then activate
the published agency versions separately. Explicit demonstration fixture setup
still seeds its baseline and optional definitions.

To completely rebuild a local development database from the current contents of
`defines/`, load the private values and run the guarded reset command:

```sh
set -a
source ./.env.local
set +a
npm run db:reset:development -- --confirm-reset
```

The command refuses non-local database hosts. It recreates the schema, loads the
catalog referenced by the form marked `default: true`, activates that matching
form/validation pair, and publishes every other matching pair as an inactive
option. It recreates the synthetic demo account but deliberately leaves owner
bootstrap as a separate, password-prompting operation.

For database-backed demonstration journeys, first apply migrations and create the
ordinary installation organization. Then seed the optional demo fixture account:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run bootstrap:synthetic -w @open-triage/database
```

The command creates the `demo` account if missing, with the protected Demo role
and initial password `opentriagedemo`, without requiring a first-login password
change. Replays never reset its password, reactivate it, or restore roles removed
by an owner. The account has no authority until the
organization has a normal installation owner; follow
[`docs/runbooks/identity-recovery.md`](docs/runbooks/identity-recovery.md) for owner setup.

Generate varied synthetic reports from an agency's active form and validation
with `npm run generate:synthetic -- --agency UUID --count 100
--from 2026-09-01 --to 2026-09-30`. See the
[synthetic record CLI runbook](docs/runbooks/synthetic-record-generation.md) for
random user assignment, distributions, dry runs, and draft output. No user password
is required; add `--username USER` to select a fixed clinician.

To ingest one vendor snapshot explicitly, pass the file and caller-owned organization
and source context to the JSON-output CLI:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run dispatch:ingest -w @open-triage/api -- \
  --file packages/contracts/examples/dispatch/synthetic-assignment-01.json \
  --organization-id 32000000-0000-4000-8000-000000000001 \
  --source-id synthetic-bootstrap
```

The login form never exposes or prefills fixture credentials. Demonstration and
production deployments use the same ownership, password, authorization, publication,
export, and ordinary ten-year clinical-retention policy. Synthetic clinical records
are created explicitly by users with Clinical Demo authority and expire according to
the agency’s demo-record policy at creation (24 hours by default). Agency Settings
accepts positive whole hours without a product maximum; a blank value disables
automatic deletion for new records. Existing record deadlines remain unchanged.

Draft clients use `POST /api/reports` with client-generated UUIDv4 report,
incident, patient, and command identities. The API derives the analytical patient
key; clients must not submit one. Incremental autosaves go to
`POST /api/reports/:id/draft-changes` with an expected revision, stable group and
occurrence identities, and sparse typed values. `GET /api/reports/:id` returns the
pinned versions, current revision, groups, and occurrences. Retrying an identical
command returns its original result, while reusing its identity for different content
returns HTTP 409. Saves from a stale base revision reconcile per stable target:
disjoint edits merge, collisions prefer the latest client time within the five-minute
future-skew guard, and equal or untrustworthy times follow server receipt order. Losing
values and both commands' lineage remain in append-only reconciliation audit data.
The supported local persistence window and byte-preserving recovery behavior are
documented in [`docs/browser-state-compatibility.md`](docs/browser-state-compatibility.md).
The production protected-storage guarantee, lifecycle behavior, operational
requirements, threat exclusions, and deferred device controls are documented in
[`docs/protected-offline-clinical-storage.md`](docs/protected-offline-clinical-storage.md).

## Start a production server with Kubernetes or Tanzu

Use the [production installation runbook](docs/runbooks/kubernetes-production.md).
It covers identifying your Tanzu edition, preparing a workload cluster, Harbor,
PostgreSQL, ingress, DNS and TLS, generating private workload credentials,
bootstrapping the owner, and checking the rollout. Production uses built containers
and Helm; `npm run dev` and local Supabase are development tools.

Copy [the production values template](deploy/helm/open-triage/production-reference.values.yaml)
outside the repository and complete the runbook's setup steps. Then run:

```sh
# Read-only preflight: explicit workload-cluster context, existing namespace/Secrets.
npm run deploy:kubernetes -- --context YOUR_WORKLOAD_CONTEXT \
  --values /private/open-triage/production.values.yaml

# Apply migrations, install or upgrade, and wait for readiness.
npm run deploy:kubernetes -- --context YOUR_WORKLOAD_CONTEXT \
  --values /private/open-triage/production.values.yaml --apply
```

The helper checks real hosts, pinned images, TLS, restricted pod settings,
workload Secret keys, RBAC, and server admission before installation. It does not
create a cluster or database. A fresh installation still requires approved clinical
configuration before patient care; the runbook describes this commissioning boundary.

## Hosted Kubernetes demonstration

The synthetic-data-only demo is deployed to DigitalOcean Kubernetes after every
successful validation of `main`. The web application is available at
[https://demo.opentriage.org](https://demo.opentriage.org), with its API at
[https://api.demo.opentriage.org](https://api.demo.opentriage.org).

Operators should follow the [demo deployment runbook](docs/demo-deployment.md)
for required credentials and infrastructure, release safeguards, failure
recovery, and the strict synthetic-data boundary.

## Prototype interaction model

- The active application uses one clinically neutral, versioned standard encounter
  definition. Complaint data is ordinary encounter content and never selects,
  enables, hides, requires, reorders, or otherwise changes form behavior.
- Synthetic seed data contains dispatch information and timestamps only through
  arrival on scene. The patient, incident, address, and identifiers are explicitly
  fictional and never represent a complete clinical record.
- A sticky quick-action rail keeps vitals, medications, procedures, notes, and
  patient information available near the top of the screen.
- Medication and procedure capture begin with offline searchable catalogs, then
  advance to documentation details after selection.
- Quick capture is intentionally non-blocking: incomplete or unusual entries can
  be saved immediately. Validation is deferred to the warnings-and-errors
  checklist and becomes blocking only when the encounter is signed.
- Checklist findings open the affected entry. The offending picker control is
  framed red for an error or amber for a warning and clears as soon as the draft
  value validates. Vitals retain explicit unavailable and pertinent-negative
  choices behind the compact `×` control.
- Timeline dots summarize each event's current validation state: green is clear,
  amber is warning, and red is error.
- Product owner decision (2026-09-10): the obsolete completed-summary view and its configurable
  event ordering are unsupported and are not mapped to the live timeline. Stored browser state that
  still selects that view is moved intact to the explicit raw-recovery key. The live timeline,
  clinical note summary field, and vital-sign summary remain independent supported behavior.
- Patient quick capture covers selected demographics plus medical history,
  current medications, and allergies from the NEMSIS `ePatient` and `eHistory`
  domains.

## Architecture rule

NEMSIS identifiers are source metadata, not application structure. Form sections, labels,
requirements, order, and code systems belong in versioned configuration. Deployment-specific
overrides can later replace that configuration without changing UI components or database schema.
The standard form must remain independent of complaint and clinical category; repository tests
reject category-specific identities and conditional form controls in active source.

## License

OpenTriage is licensed under the GNU Affero General Public License v3.0 only
(AGPL-3.0-only). Reusable interoperability libraries may be explicitly designated
under Apache-2.0. See `LICENSE` and `LICENSES/README.md` for details.
