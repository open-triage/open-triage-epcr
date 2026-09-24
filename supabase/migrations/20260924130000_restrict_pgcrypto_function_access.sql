-- PostgreSQL grants function execution to PUBLIC by default. Remove that
-- implicit access from pgcrypto itself, then restore only the digest overloads
-- used by the API and retention contracts. This works whether the extension is
-- installed in public (stock PostgreSQL) or extensions (managed PostgreSQL).
do $$
declare
  extension_schema text;
  extension_function record;
  workload_role text;
begin
  select namespace.nspname into extension_schema
  from pg_extension extension
  join pg_namespace namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if extension_schema is null then
    raise exception 'pgcrypto extension is unavailable';
  end if;

  for extension_function in
    select procedure.oid::regprocedure signature,
      procedure.proowner owner_oid,
      procedure.proacl privileges
    from pg_depend dependency
    join pg_extension extension on extension.oid = dependency.refobjid
    join pg_proc procedure on procedure.oid = dependency.objid
    where extension.extname = 'pgcrypto'
      and dependency.classid = 'pg_proc'::regclass
      and dependency.refclassid = 'pg_extension'::regclass
      and dependency.deptype = 'e'
  loop
    if extension_function.owner_oid = (select oid from pg_roles where rolname = current_user) then
      execute format('revoke all on function %s from public', extension_function.signature);
    elsif exists (
      select 1
      from aclexplode(coalesce(
        extension_function.privileges,
        acldefault('f', extension_function.owner_oid)
      )) privilege
      where privilege.grantee = 0
        and privilege.privilege_type = 'EXECUTE'
    ) then
      raise exception
        'platform-owned pgcrypto function % still grants EXECUTE to PUBLIC',
        extension_function.signature;
    end if;
  end loop;

  foreach workload_role in array array[
    'open_triage_api_runtime',
    'open_triage_retention_executor'
  ] loop
    if exists (select 1 from pg_roles where rolname = workload_role) then
      execute format('grant usage on schema %I to %I', extension_schema, workload_role);
      execute format(
        'grant execute on function %I.digest(bytea, text) to %I',
        extension_schema,
        workload_role
      );
      execute format(
        'grant execute on function %I.digest(text, text) to %I',
        extension_schema,
        workload_role
      );
    end if;
  end loop;
end;
$$;
