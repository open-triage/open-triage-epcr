-- Managed PostgreSQL installations commonly place pgcrypto in an extensions
-- schema, while a stock PostgreSQL installation creates it in public. Keep the
-- stable public.digest calls used by migrations and stored procedures portable
-- without relocating an installation-managed extension.
do $$
declare
  digest_schema text;
begin
  if to_regprocedure('public.digest(bytea,text)') is not null
     and to_regprocedure('public.digest(text,text)') is not null then
    return;
  end if;

  select n.nspname into digest_schema
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.proname = 'digest'
    and pg_get_function_identity_arguments(p.oid) = 'bytea, text'
  order by (n.nspname = 'extensions') desc, n.nspname
  limit 1;

  if digest_schema is null then
    raise exception 'pgcrypto digest(bytea,text) is unavailable';
  end if;

  if to_regprocedure('public.digest(bytea,text)') is null then
    execute format(
      'create function public.digest(bytea, text) returns bytea language sql immutable strict parallel safe set search_path = '''' as %L',
      format('select %I.digest($1, $2)', digest_schema)
    );
  end if;

  if to_regprocedure('public.digest(text,text)') is null then
    execute format(
      'create function public.digest(text, text) returns bytea language sql immutable strict parallel safe set search_path = '''' as %L',
      format('select %I.digest($1, $2)', digest_schema)
    );
  end if;
end;
$$;
