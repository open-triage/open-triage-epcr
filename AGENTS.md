# Local database-backed development

Launch the API and web app as separate processes. Do not source the root
`.env.local` before running the root `npm run dev`: its API `PORT=3001` value is
otherwise inherited by Next.js, so the web app and API compete for port 3001.

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
