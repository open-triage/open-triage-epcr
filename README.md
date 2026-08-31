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

The NestJS API uses TypeORM with `DATABASE_URL`. Supabase SQL migrations remain the single
source of truth for schema changes; TypeORM's `synchronize` option is disabled.

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

The private source repository cannot use GitHub Pages on the account's current
plan, so only the generated `apps/web/out` artifact is published in the public
`annakopp/open-triage-epcr-demo` hosting repository. CI verifies that artifact
and its browser-only journey without starting any backend service.

## Architecture rule

NEMSIS identifiers are source metadata, not application structure. Form sections, labels,
requirements, order, and code systems belong in versioned configuration. Deployment-specific
overrides can later replace that configuration without changing UI components or database schema.

## License

OpenTriage is licensed under the GNU Affero General Public License v3.0 only
(AGPL-3.0-only). Reusable interoperability libraries may be explicitly designated
under Apache-2.0. See `LICENSE` and `LICENSES/README.md` for details.
