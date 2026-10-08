# OpenTriage

OpenTriage is an open-source, browser based application for ambulance patient care records.
Clinicians can record care on a phone, finish and sign the same report on a larger
screen, and follow up through review and analytics. Agencies can configure their
forms, documentation checks, language, and access permissions. OpenTriage bases its
information model on [NEMSIS 3.5.1](https://nemsis.org/), a technical standard for emergency medical services data.

This guide describes the repository as of **8 October 2026**. Features shown in
an installation depend on its configuration and your permissions. OpenTriage is
under active development; the public demo is for fictional data only. Real-patient
deployment requires the agency's own configuration, validation, and operational
readiness work described in the [clinical adoption guide](docs/compliance/clinical-adoption.md).

## Contents

- [Try the demo](#try-the-demo)
- [Choose your workspace](#choose-your-workspace)
- [User guide](#user-guide)
- [Administration](#administration)
- [Planned and deferred functionality](#planned-and-deferred-functionality)
- [Installation and development](#installation-and-development)
- [Further documentation](#further-documentation)
- [License](#license)

## Try the demo

Open [demo.opentriage.org](https://demo.opentriage.org) and sign in with username
**`demo`** and initial password **`opentriagedemo`**. The login form does not fill
these in automatically. The shared demonstration account and its records are
for trying the workflow; enter only fictional patient information.

For a short walkthrough:

1. Choose **Mobile**, then **Generate call** in the demo controls. Select a unit
   if prompted and open the generated assignment. **New patient** can also start
   a report without a dispatch assignment.
2. Add a vital-sign set and a text, photo, or audio note. Open a timeline entry 
   to inspect or edit it.
3. Choose **Save & close**, switch to **Stationary**, and reopen the same report
   from **Open calls**. **Populate** can fill empty fields with demonstration data;
   **Clear** removes data added by that tool.
4. Choose **Review & sign**, resolve the listed problems, acknowledge warnings,
   and sign once changes and media have synchronized.
5. Open **Review** to explore follow-up work, then its **Analytics** tab to create
   a chart or table of eligible signed reports.

Demo controls require an online session and permission to use synthetic records.
They do not modify ordinary patient reports. Synthetic records normally expire
after 24 hours; an agency can change or disable expiry for newly created demo
records. Treat the shared demo as a temporary workspace.

## Choose your workspace

Use the workspace selector in the application header. Only modes your account
may use are shown. Save and close an open report before moving to administration
or review.

| Workspace | What it is for | What is available now |
| --- | --- | --- |
| **Mobile** | Documenting during a call | Assigned and open calls; quick entry for vitals, medications, procedures, text, photos, and spoken-audio notes; timeline; checklist; draft saving. |
| **Stationary** | Completing documentation on a desktop or tablet | The same report in a full section-based form, repeatable entries, timeline, validation, and online signing. |
| **Review** | Following up on documentation and quality | Review queues, report inspection, assign review tasks, discuss reports marked for review, document review outcomes, and an Analytics tab for generating basic descriptive statistics. |
| **Admin** | Managing the installation | Users, roles, clinical configuration, agency settings, review settings, and an operational dashboard. |

Mobile and Stationary are two views of the same report. Changing the view does
not create another record or grant additional access. Review and Admin worksapces require
connectivity.

## User guide

### Sign in and open a report

For an agency installation, use the account supplied by your administrator.
A temporary password may need replacement at first sign-in. If a workspace is
missing, ask the administrator to check your roles. Custom roles can limit access
to particular tasks; the built-in Administrator role has full access.

**Assigned calls** contains incoming work for your associated unit. Opening an
assignment creates its report, or returns the report already created for it.
**Open calls** contains your unfinished reports. Use **New patient** when starting
without a dispatch assignment. Signing in and opening new work require a connection. Integration with SSO services is planned but not implemented.

### Document care

In **Mobile** mode, use the quick actions for **Vitals**, **Medication**, **Procedure**,
**Text note**, **Photo note**, and **Audio note**. Events and notes appear in the
timeline; select an entry to inspect or edit it. Use the checklist for the rest
of the required documentation.

In **Stationary** mode, use the section navigation to move through the full form.
Add separate entries for repeated observations or treatments. The timeline can
be opened beside the form to inspect events and notes, including photos and
audio captured in Mobile. Media capture starts in Mobile; Stationary supports
viewing and permitted draft-note edits.

Photos use the live camera and audio notes record speech. Allow camera or
microphone access when prompted, preview the capture, then save it. Audio is
not automatically transcribed. Each media note must reach **Ready** status before
signing; retry or remove a failed upload. Photo and audio capture have been
validated on Android with Chrome and iOS with Safari.

The agency determines which fields, choices, and documentation checks are active.
An existing report keeps the configuration version it started with, so a later
form publication does not silently change that report's requirements.

### Save, close, and work through connection loss

Draft changes save automatically. Watch the saving and synchronization indicators:
**Pending sync** means there is work still to send. **Save & close** lets you
leave an unfinished report even when documentation checks still need attention;
it does not sign the report.

An already opened, unlocked report can remain editable during a connection loss
when protected browser storage is available and the session remains valid.
Pending changes synchronize after reconnection. Keep the app open when possible
until uploads finish, and follow any storage or recovery notice it displays.

Reloading or restarting the browser is a different situation: retained drafts
are encrypted and require an online recovery step, including password confirmation
when requested. Signing in, opening a new assignment, signing a report, Review,
and Admin are online operations. Do not clear browser data while changes remain
unsynchronized. See [protected offline storage](docs/protected-offline-clinical-storage.md)
for the recovery limits.

### Check and sign

Open the report in **Stationary** and select **Review & sign**. Follow each
finding to the relevant field or entry. Correct blocking errors, acknowledge
warnings, and resolve any differences between your documentation and later
dispatch updates. Wait for draft synchronization and media readiness, then
complete the signing confirmation while online.

Signing freezes the report and removes it from the open-call list. **Mobile does
not sign reports.** Signed reports are available through authorized Review access.
The backend supports amendments, but a clinician-facing amendment editor is
still pending; a signed report cannot be reopened as an editable draft.

### Review reports and follow-up work

Choose **Review** to see reports and review items within your access scope.
Clinicians can have access to their own reports; authorized reviewers can work
across the agency. Identifying information, free text, photos, and audio require
additional permission even when a report is otherwise visible.

Use the queue's filters for assignment, priority, status, and review criterion
to find work. Open an item to read the report and the reason it needs attention.
Eligible reviewers can claim unassigned work; review administrators can assign
or reassign items. Record a discussion response where permitted, update progress,
and choose an outcome when completing your assigned item. Completing review does
not change the clinical report.

Review also supports overdue unsigned-report follow-up and independent-review
requirements. These depend on the agency's rules and Review settings. Multiple
concerns can create separate review items for one report.

### Explore Analytics

Inside **Review**, select **Analytics**. Choose a date range, a metric, an
aggregation, optional grouping and filters, and **Line**, **Bar**, or **Table**.
Select **Update visualization** to apply your choices. Editing controls alone
does not replace the displayed result.

The metric picker offers **Records** plus published metrics and rules enabled
for Review. Depending on the selection, you can explore record counts,
percentages, numeric summaries, or rule pass/fail results. Recorded fields and
custom fields can be used for supported grouping and filtering. Clinical
statistics use eligible signed reports, including effective amendments; an
unfinished draft is not part of that population.

Use **Save visualization** to keep the parameters in your account, or choose a
saved visualization and run it again. Saved parameters do not freeze the data.
**Export** offers aggregate or record-level CSV files within your permissions.
Results show included records and missing or excluded data; narrow the dates or
filters if the query reaches a limit. Recent changes may take time to appear in
the analytical data.

### Send feedback

While signed in and online, use the bug-icon feedback control in the header.
Choose **Bug** or **Feature**, describe what happened or what you need, and submit.
Keep the returned reference code for follow-up. Do not include patient-identifying
information in the message; free text is not automatically anonymized.

## Administration

Authorized administrators can manage the following areas online:

| Area | What you can do |
| --- | --- |
| **Users and Roles** | Create and disable accounts, reset credentials, manage sessions, assign permissions, define custom roles, and transfer ownership through the owner workflow. |
| **Element catalog** | Define the data and choices available to forms, including supported custom fields and groups. |
| **Stationary form** | Arrange sections and fields, control field choices, preview the form, and publish and activate compatible versions. |
| **Validation rules** | Author documentation checks, review criteria, and numeric metrics in a shared versioned configuration. |
| **Agency Settings** | Set agency language and regional formatting, time zone, branding, agency details, media limits, demo-record expiry, and available login limits. |
| **Review settings** | Configure routing, outcomes, independent review, and overdue follow-up. |
| **Dashboard** | Inspect active configuration and operational counts. |

English and Swedish interface translations are available. Catalog, form, and rule
wording can carry versioned translations; missing translations fall back to English.
Agency language and regional preferences take effect when a workspace loads.

Clinical configuration follows a draft, validation, publication, and activation
workflow. Publishing preserves a version; activation makes compatible published
configuration available for new reports. JSON definition files can be imported
through the Catalog, Form, and Validation editors. Existing reports retain their
original versions. Start with the [data-model authoring guide](docs/data-model-authoring.md)
and [validation rollout guide](docs/runbooks/validation-rollout.md).

## Planned and deferred functionality

The [product requirements index](docs/prds/README.md) distinguishes original
milestones, implemented features, and later direction. The following work remains
outside the current user-facing workflow; these are scope references, not release
dates or delivery commitments.

| Area | Current boundary and later direction | Product reference |
| --- | --- | --- |
| **Signed-record tools** | Signed viewing and backend amendments exist. A clinician amendment editor, a general audit-history browser, and dedicated print/PDF output remain broader product goals. | [Demo product vision](docs/prds/open-triage-demo.md) |
| **Historical review runs** | Backend support can evaluate older reports against selected review rules. Connecting this to the current Review workspace remains unfinished. | [Review](docs/prds/review.md) |
| **Operational administration** | Units support assignments, but dedicated unit/vehicle management, a general configuration-history browser, and integration-management screens remain deferred. | [Admin controls](docs/prds/admin-controls.md) |
| **Device management** | Protected offline drafts exist. Device enrollment, vehicle pairing, inventory, and device revocation are deferred. | [Protected offline storage](docs/prds/protected-offline-clinical-storage.md) |
| **External identity** | Local accounts, roles, and sessions exist. External identity-provider integration, multifactor authentication, and self-service forgotten-password delivery are deferred. | [Users and roles](docs/prds/users-roles.md) |
| **External systems** | A vendor dispatch payload and ingestion path exist. Live dispatch adapters and hospital, monitor, or national-system integrations require separate work; NEMSIS XML patient-record exchange is unsupported. | [Dispatch payload](docs/prds/dispatch-payload.md), [demo scope](docs/prds/open-triage-demo.md) |

Offline signing and administration, automatic audio transcription, and predictive
clinical decision support are outside the current PRD scope. The existence of
configurable checks or metrics does not establish those capabilities.

## Installation and development

The sections below are for developers and installation operators. People using
an existing agency installation do not need a local setup.

### Repository layout

- `apps/web`: Next.js/React progressive web app
- `apps/api`: NestJS API
- `packages/contracts`: shared, framework-independent types and form definitions
- `supabase`: local Supabase configuration and SQL migrations
- `defines`: Canonical transferable JSON files defining agency element, form, validation, and localization configurations.
- `docs`: product requirements, architecture notes, and operational runbooks

The product requirements documents are indexed in
[`docs/prds/README.md`](docs/prds/README.md).

### Start a local development instance

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

### Development database and fictional records

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

### Dispatch ingestion and draft persistence

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

### Start a production server with Kubernetes or Tanzu

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

### Hosted Kubernetes demonstration

The synthetic-data-only demo is deployed to DigitalOcean Kubernetes after every
successful validation of `main`. The web application is available at
[https://demo.opentriage.org](https://demo.opentriage.org), with its API at
[https://api.demo.opentriage.org](https://api.demo.opentriage.org).

Operators should follow the [demo deployment runbook](docs/demo-deployment.md)
for required credentials and infrastructure, release safeguards, failure
recovery, and the strict synthetic-data boundary.

### Architecture rule

NEMSIS identifiers are source metadata, not application structure. Form sections, labels,
requirements, order, and code systems belong in versioned configuration. Agencies
adapt that configuration through the authoring and publication workflows without
changing UI components or the database schema.
The standard form must remain independent of complaint and clinical category; repository tests
reject category-specific identities and conditional form controls in active source.

## Further documentation

- [Product requirements and status](docs/prds/README.md)
- [Clinical adoption and readiness](docs/compliance/clinical-adoption.md)
- [Local setup and troubleshooting](docs/runbooks/local-development.md)
- [Production installation](docs/runbooks/kubernetes-production.md)
- [Database architecture](docs/database-architecture.md)
- [Clinical configuration authoring](docs/data-model-authoring.md)
- [Analytics behavior and limits](docs/runbooks/unified-analytics.md)
- [Metric definitions and interpretation](docs/runbooks/metric-library.md)
- [Protected offline storage and recovery](docs/protected-offline-clinical-storage.md)

## License

OpenTriage is licensed under the GNU Affero General Public License v3.0 only
(AGPL-3.0-only). Reusable interoperability libraries may be explicitly designated
under Apache-2.0. See `LICENSE` and `LICENSES/README.md` for details.
