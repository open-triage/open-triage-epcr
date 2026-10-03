# Local database-backed development

Use `npm run dev` (or its alias `npm run dev:local`) from the repository root.
The helper loads `.env.local` itself, launches the API and web as separate
processes, keeps private root values out of the web environment, and removes
the API `PORT` value before starting Next.js on port 3000.

Before launch it checks both app ports and connects to PostgreSQL. For a refused
connection to the default local Supabase database on port 54322, it tries Docker
and then `docker.exe` on WSL, starts Docker Desktop if needed, and resumes only
the existing `supabase_db_<project_id>` database container. It waits through
PostgreSQL startup recovery before launching the API and analytics watcher.
It creates no containers or accounts and performs no database migrations or resets.

On a fresh machine, install Docker and the Supabase CLI, run `supabase start`
from the root, and follow `docs/runbooks/local-development.md` to apply migrations,
create the demonstration organization, and bootstrap its ordinary installation owner.
Run `npm run dev -- --check` to check environment, ports, and database readiness
without launching the app; this may start the existing database and Docker Desktop.
If ports are already occupied, inspect the running app or stop its supervisor
before starting another instance. Do not treat a running Next.js server as proof
that the API or database is ready.

For manual startup, first ensure PostgreSQL is ready. Launch the API and web as
separate processes. Source root private values only in the API process:

From the repository root, start the API with the private server/database values:

```sh
set -a
source ./.env.local
set +a
npm run dev -w @open-triage/api
```

In a second process, start the web app without inheriting an API `PORT` value:

```sh
env -u PORT npm run dev -w @open-triage/web
```

The database-backed app is then available at `http://localhost:3000`, with the
API at `http://localhost:3001`.

After creating the normal demonstration organization, seed the fictional,
idempotent local `demo` / `opentriagedemo` fixture account before using the app:

```sh
set -a
source ./.env.local
set +a
npm run bootstrap:synthetic -w @open-triage/database
```

The bootstrap does not create an organization or installation owner, and it
never resets an existing fixture account. Complete ordinary owner setup before
the account receives application capabilities.

Confirm the API is ready with `GET http://localhost:3001/api/health`. A successful
demo login followed by `GET /api/calls/assigned` confirms the seeded database
workflow end to end.
