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

## Architecture rule

NEMSIS identifiers are source metadata, not application structure. Form sections, labels,
requirements, order, and code systems belong in versioned configuration. Deployment-specific
overrides can later replace that configuration without changing UI components or database schema.
