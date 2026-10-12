# Local database-backed development

## First-time setup

Install Node.js 22 or newer, a Docker engine or Docker Desktop, and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
The repository already contains `supabase/config.toml`; run all local Supabase
commands from the repository root. On WSL, enable Docker Desktop integration for
your distribution. The startup helper also supports `docker.exe` on `PATH`.

```sh
npm install
cp .env.example .env.local
supabase start
```

Configure `.env.local` with the PostgreSQL connection string and private installation
values. The default local database is `127.0.0.1:54322/postgres`. Set
`PATIENT_KEY_INSTALLATION_ID` to a UUID and `PATIENT_KEY_SECRET_BASE64` and
`AUTH_RATE_LIMIT_SECRET_BASE64` to distinct random 32-byte secrets encoded in base64.
Keep them in `.env.local`, which is ignored by Git. Root startup reads this file
directly; sourcing it first is unnecessary. Exported shell variables take precedence.

Apply the repository schema migrations with the private values
loaded in a subshell:

```sh
(
  set -a
  source ./.env.local
  set +a
  npm run migrate -w @open-triage/database
)
```

For a local demonstration installation, create its ordinary organization using
the local Supabase Studio SQL editor at http://localhost:54323. This statement
preserves an existing organization:

```sql
insert into app_identity.organization (id, name, deployment_timezone)
values ('32000000-0000-4000-8000-000000000001', 'Demonstration EMS', 'UTC')
on conflict (id) do nothing;
```

Bootstrap the installation owner (which needs no organization ID) with a separate username and a password entered
at the prompt. Skip this step when the organization already has an owner; see the
[identity recovery runbook](identity-recovery.md) for existing-account recovery.

```sh
(
  set -a
  source ./.env.local
  set +a
  npm run identity:account -w @open-triage/api -- bootstrap-owner \
    --username local.owner \
    --display-name "Local Installation Owner" \
    --operator-id local-development-setup
)
```

Seed the fictional demo fixture after organization and owner setup. This explicit
fixture command loads its baseline catalog, form, and validation definitions:

```sh
(
  set -a
  source ./.env.local
  set +a
  npm run bootstrap:synthetic -w @open-triage/database
)
```

The fixture starts with username `demo` and password `opentriagedemo`. Repeating
bootstrap preserves existing passwords, account state, and owner-controlled role
assignments. Bootstrap creates neither an organization nor an owner. An empty
assigned-call list is valid; use the explicit dispatch ingestion command in the
[README](../../README.md) when you need a fictional assigned call.

## Import agency definitions

Opening an Admin editor and applying schema migrations do not import JSON files.
In Catalog, Forms, or Validation, select a JSON file in the import controls,
and click **Import selected file**. Imports create published agency versions;
activation remains a separate action. Publish or discard your draft before
importing. Files must match a published catalog available to the agency.

Files are read from the corresponding folder under `defines/` (including its
`local/` exports), or `OPENTRIAGE_DEFINITIONS_ROOT` when configured. The explicit
synthetic fixture setup commands above still seed their demonstration data.

## Daily startup

```sh
npm run dev
```

`npm run dev:local` and `bash scripts/dev-local.sh` use the same helper. It:

1. Loads `.env.local` and checks that web port 3000 and the API `PORT` (3001 by
   default) are available, without requiring `lsof`.
2. Connects to PostgreSQL and verifies a query, waiting up to 90 seconds for
   transient startup errors. Authentication/configuration errors fail immediately
   with an error code; connection credentials are not printed.
3. For a refused connection to a loopback database on port 54322, tries `docker`
   and then `docker.exe`. If necessary, it starts Docker Desktop and resumes the
   existing `supabase_db_<project_id>` container identified by `supabase/config.toml`.
   The container must publish port 54322. Hosted databases and other local ports
   use readiness checks without automatic Docker actions.
4. Starts the API/analytics watcher and Next.js as separate process groups.
   Private root configuration stays in the API; the web receives root
   `NEXT_PUBLIC_*` values with `PORT` removed and runs on port 3000.
5. Waits for both `GET /api/health` and the web page before printing “OpenTriage is
   ready”. HTTP startup has a 120-second deadline. Failure stops both groups and
   their watchers, so a failed startup does not leave a partial app running.

The helper resumes existing infrastructure. First-time container creation,
migrations, organization/owner setup, and demo seeding are explicit setup steps.
Ctrl+C stops app processes together and leaves the database running for reuse.

To check prerequisites without launching the app:

```sh
npm run dev -- --check
```

This also checks that app ports are free and may start Docker Desktop and the
existing database container. Use it before launching the app.

Open http://localhost:3000 for the landing page or http://demo.localhost:3000
for the demo agency. The API is at http://localhost:3001 by default.
Verify `curl --fail http://localhost:3001/api/health`, sign in, and confirm the
assigned-call screen loads. A successful demo login followed by a successful
`GET /api/calls/assigned` confirms the database workflow. API health alone confirms
service availability, not account or fixture readiness.

## Manual startup

Make PostgreSQL ready first. Start the API in one terminal:

```sh
set -a
source ./.env.local
set +a
npm run dev -w @open-triage/api
```

Start the web in a separate terminal with public configuration only:

```sh
env -u PORT NEXT_PUBLIC_API_URL=http://localhost:3001 npm run dev -w @open-triage/web
```

Direct workspace commands bypass the root preflight and HTTP readiness checks.
If the API exhausts its connection retries while Nest's watcher remains open,
stop that workspace command, make PostgreSQL ready, and restart it.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Port 3000 or 3001 already in use | Stop the existing app supervisor with Ctrl+C, or inspect its health if you intended to reuse it. Do not launch a duplicate instance. |
| WSL reports that Docker is unavailable | Enable Docker Desktop integration for this distribution, or ensure the Windows `docker.exe` is on `PATH`. |
| Docker engine is unavailable | Start Docker Desktop or your Docker daemon manually and retry. Automatic Desktop startup requires the `docker desktop start` CLI command. |
| Existing Supabase database container is missing | Run `supabase start` from the repository root with Docker running, then retry. The helper does not create containers or install tools. |
| PostgreSQL is starting up (`57P03`) | The helper waits for recovery. If its deadline expires, inspect the project database container logs and resolve the startup failure. |
| Database authentication fails (`28P01`) | Correct the private `DATABASE_URL` credentials. Docker restart cannot fix a credential mismatch. |
| Schema or installation configuration is missing | Apply repository migrations and complete organization/owner setup, then run the idempotent fixture bootstrap. |
| Web renders but API is unavailable | Use root `npm run dev` so API readiness is checked. For manual startup, verify `/api/health` and restart the API after restoring PostgreSQL. |
| Demo credentials fail or the account has no capabilities | Check ordinary owner setup and account state. Bootstrap preserves existing passwords and roles; use the identity recovery runbook when a reset is needed. |

`npm test` runs the automated suite separately from app startup. Failed tests
should be investigated from their assertions; successful HTTP startup does not
mean the suite passed. Use `npm run test:workflow` for the startup regression
tests and other root workflow checks.

### Local agency subdomains

In development, `http://localhost:3000` serves the public landing page. Its demo
link opens `http://demo.localhost:3000`. Modern browsers resolve `*.localhost`
to loopback without a hosts-file entry. The existing fictional demonstration
organization uses `demo.localhost` while its configured hostname is empty.
Explicit agency hostname assignments take precedence.

For another agency, enter a subdomain such as `test` in Super-admin (with the
local default hostname suffix `localhost`), then open `http://test.localhost:3000`.
The browser uses the same subdomain on the API port, keeping agency cookies
separate. Only active, registered agencies are accepted; unknown subdomains do
not fall back to another agency. The HTTP origin allowance and landing-page
routing apply only in development. `http://localhost:3000/admin/` remains the
installation administration entry point.

With the local servers running, verify landing navigation, demo login, reload,
and cookie isolation with:

```sh
npx playwright test --config apps/web/playwright.local.config.ts
```

### Shared host routing

Use `NEXT_PUBLIC_API_URL=same-origin` in `.env.local` (replace the older
`http://localhost:3001` value). The development and local static servers share
one edge router: `/api/*` goes to the API with the original `Host`, cookies, and
request body; other requests go to the web app. The demo and production Helm
installations use the same paths. Agency subdomains therefore do not need a
separate API hostname or a different web build.

`npm run dev` derives the private API upstream from `PORT`, defaults the landing
host to `localhost`, and keeps the app on `demo.localhost:3000` or another
registered agency host. Set `OPEN_TRIAGE_PUBLIC_SITE_HOST` to another hostname,
or to an empty string to serve the app on every host.

For a local production-build check, build the web with
`NEXT_PUBLIC_API_URL=same-origin`, then run the static server separately from the
API:

```sh
OPEN_TRIAGE_API_UPSTREAM=http://127.0.0.1:3001 \
OPEN_TRIAGE_PUBLIC_SITE_HOST=localhost \
PORT=3000 npm start -w @open-triage/web
```

This server binds loopback and is intended for local artifact checks. Production
installations use the web image and Helm ingress with TLS. `npm start` does not
load root `.env.local` or start the API/database. Organization registration and
access checks still apply; DNS routing alone does not grant access to an agency.

## Before pushing CI/CD fixes

Run `npm run check:ci` to run typechecking, lint, all unit tests, a production
same-origin build and browser smoke test, followed by database/API integration
and scale checks in a disposable PostgreSQL 15 container matching CI. Install
Playwright Chromium first (`npx playwright install chromium`). Docker must be
running; on WSL without a Linux Docker client, use
`DOCKER_COMMAND=docker.exe npm run check:ci`.

This command does not load `.env.local` or use the development database. The
browser unit suite tests unset, same-origin, and explicit API URL configurations.
The disposable database is removed on completion, including test failure.
Use this complete check rather than interpreting skipped database tests in
`npm test` as database validation.
