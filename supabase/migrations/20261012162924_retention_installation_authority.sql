-- Retention uses the same agency-resolved authority as other administrative
-- operations. Installation administrators intentionally have no home agency.
-- Preserve the existing deletion implementation and its security/hold checks.
do $$
declare
  definition text;
  prior_guard constant text := $prior$    and u.organization_id = selected_batch.organization_id
    and u.active
    and app_identity.user_has_capability($prior$;
  current_guard constant text := $current$    and u.active
    and app_identity.user_has_capability($current$;
begin
  select pg_get_functiondef('retention.delete_verified_batch(uuid,uuid)'::regprocedure) into definition;
  if strpos(definition, prior_guard) = 0 then
    raise exception 'could not locate agency-bound retention authorization';
  end if;
  execute replace(definition, prior_guard, current_guard);
end;
$$;
