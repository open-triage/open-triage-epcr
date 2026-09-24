\set ON_ERROR_STOP on

-- This fixture deliberately uses stock PostgreSQL so CI can exercise the
-- application against both portable defaults and the managed semantics that
-- matter to OpenTriage. The service image is pinned by the workflow.
--
-- psql variables:
--   managed              true for the Supabase-compatible lane
--   migration_password   password for the short-lived migration login

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_ci_migration') then
    create role open_triage_ci_migration login nosuperuser nocreatedb createrole
      inherit nobypassrls;
  end if;
end;
$$;

alter role open_triage_ci_migration password :'migration_password';
alter database open_triage_test owner to open_triage_ci_migration;

\if :managed
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin nosuperuser nocreatedb nocreaterole inherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin nosuperuser nocreatedb nocreaterole inherit nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin nosuperuser nocreatedb nocreaterole inherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end;
$$;

grant anon, authenticated, service_role to authenticator;

create schema if not exists extensions authorization postgres;
revoke all on schema extensions from public;
create extension if not exists pgcrypto with schema extensions;
revoke all on all functions in schema extensions from public;
grant usage on schema extensions to open_triage_ci_migration with grant option;
grant execute on function extensions.digest(bytea, text),
  extensions.digest(text, text) to open_triage_ci_migration with grant option;

-- Supabase roles can resolve installed extensions even though the objects are
-- kept out of public. The migration owner mirrors that lookup behavior.
alter role open_triage_ci_migration set search_path = '"$user"', public, extensions;
\else
alter role open_triage_ci_migration set search_path = '"$user"', public;
\endif
