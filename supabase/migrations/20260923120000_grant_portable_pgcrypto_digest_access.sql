-- The portable public.digest wrappers run with the invoking workload's
-- privileges. Managed installations place pgcrypto in a restricted
-- extensions schema, so grant only the schema and digest overloads required
-- by runtime trigger and retention hashing paths.
do $$
declare
  digest_schema text;
  workload_role text;
begin
  select n.nspname into digest_schema
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'digest'
    and pg_get_function_identity_arguments(p.oid) = 'bytea, text'
    and n.nspname <> 'public'
  order by (n.nspname = 'extensions') desc, n.nspname
  limit 1;

  if digest_schema is null then
    return;
  end if;

  foreach workload_role in array array[
    'open_triage_api_runtime',
    'open_triage_retention_executor'
  ] loop
    if exists (select 1 from pg_roles where rolname = workload_role) then
      execute format('grant usage on schema %I to %I', digest_schema, workload_role);
      execute format(
        'grant execute on function %I.digest(bytea, text) to %I',
        digest_schema,
        workload_role
      );
      execute format(
        'grant execute on function %I.digest(text, text) to %I',
        digest_schema,
        workload_role
      );
    end if;
  end loop;
end;
$$;
