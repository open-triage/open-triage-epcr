# OpenTriage

Browser-based electronic patient care reporting, initially modeled on NEMSIS 3.5.1.

## Workspace

- `apps/web`: Next.js/React progressive web app
- `apps/api`: NestJS API
- `packages/contracts`: shared, framework-independent types and form definitions
- `supabase`: local Supabase configuration and SQL migrations

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
and creates a synthetic organization, versioned agency demographics, users and
capabilities, a published form, and a baseline draft report. It is safe to replay:
stable fixture identities are verified and immutable versions are never rewritten.
The fixture uses an unknown patient with a one-way synthetic pseudonym and fictional
dispatch metadata—no real patient data. It is only loaded by this explicit command;
production API and migration entry points do not import it.

Draft clients use `POST /api/reports` with client-generated UUIDv4 report,
incident, patient, and command identities. The API derives the analytical patient
key; clients must not submit one. Incremental autosaves go to
`POST /api/reports/:id/draft-changes` with an expected revision, stable group and
occurrence identities, and sparse typed values. `GET /api/reports/:id` returns the
pinned versions, current revision, groups, and occurrences. Retrying an identical
command returns its original result; reusing its identity for different content or
saving against a stale revision returns HTTP 409.

## Static prototype

The browser-only MVP is published at
[https://annakopp.github.io/open-triage-epcr-demo/](https://annakopp.github.io/open-triage-epcr-demo/).
It is a synthetic-data-only usability prototype and is not for clinical use.

The web app exports to static files and does not require the API, PostgreSQL,
Supabase, authentication, or runtime terminology access:

```sh
NEXT_PUBLIC_BASE_PATH=/open-triage-epcr-demo npm run build -w @open-triage/web
npm run test:deployment -w @open-triage/web
```

Pushes and pull requests targeting `main` run the `Verify static prototype`
workflow. It type-checks, lints, tests, exports, and exercises the browser-only
journey before uploading `apps/web/out` as the `static-prototype` workflow
artifact. A successful workflow run does **not** update GitHub Pages by itself.

The private source repository cannot use GitHub Pages on the account's current
plan. The public site is served from the root of the `main` branch in the
separate public `annakopp/open-triage-epcr-demo` repository. To publish a verified
build, a collaborator with write access to that repository must download the
`static-prototype` artifact, replace the hosting repository's generated site
files with the artifact contents, and push the result to `main`. GitHub Pages
then rebuilds [the public demo](https://annakopp.github.io/open-triage-epcr-demo/).

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
