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

## Start

1. Copy `.env.example` to `.env.local` and add Supabase credentials.
2. Run `npm install`.
3. Run `npm run dev`.

Web runs on http://localhost:3000 and the API on http://localhost:3001.

The NestJS API uses TypeORM with `DATABASE_URL` and requires PostgreSQL 15 or newer.
Supabase SQL migrations remain the single source of truth for schema changes;
TypeORM's `synchronize` option is disabled.

The clinical and analytical database design is documented in
[`docs/database-architecture.md`](docs/database-architecture.md). After applying migrations,
load the pinned NEMSIS catalog with `npm run load:catalog -w @open-triage/database`.

For local API journeys, bootstrap a clean PostgreSQL database into a complete,
fictional installation with one command:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
PATIENT_KEY_INSTALLATION_ID=00000000-0000-4000-8000-000000000001 \
PATIENT_KEY_VERSION=1 \
PATIENT_KEY_SECRET_BASE64='<base64-encoded-random-32-byte-secret>' \
  npm run bootstrap:synthetic -w @open-triage/database
```

The command applies the foundation migration when needed, loads the pinned catalog,
creates a synthetic organization, versioned agency demographics, users and
capabilities, a published form, and a baseline draft report, then ingests only the
committed initial dispatch sample through the production ingestion library. It is safe to replay:
stable fixture identities are verified and immutable versions are never rewritten.
The fixture uses an unknown patient with a one-way synthetic pseudonym and fictional
dispatch metadata—no real patient data. It is only loaded by this explicit command;
production API and migration entry points do not import it.

To ingest one vendor snapshot explicitly, pass the file and caller-owned organization
and source context to the JSON-output CLI:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run dispatch:ingest -w @open-triage/api -- \
  --file packages/contracts/examples/dispatch/synthetic-assignment-01.json \
  --organization-id 32000000-0000-4000-8000-000000000001 \
  --source-id synthetic-bootstrap
```

The mobile entry screen prefills the synthetic clinician credentials and requires
an explicit **Sign in** action. The seeded organization fixes that session at 14
hours from login; the API automatically rejects it at that deadline, and **Log out**
ends it immediately. Deployments can change `shift_session_duration_hours` on the
organization until the stationary administration interface is available.
Select `OPEN_TRIAGE_INSTALLATION_SETTINGS_BASELINE=synthetic-demo` for the API and
`NEXT_PUBLIC_INSTALLATION_SETTINGS_BASELINE=synthetic-demo` for the web app when
running this fixture. With no selection, both applications use the safe production
baseline and synthetic fixtures, sample assignment generation, and the banner stay off.

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

## Kubernetes demo

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
