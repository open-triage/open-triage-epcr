-- Administrators are also clinicians. Keep the generic delegation ceiling
-- uniform by granting the protected Administrator role clinical documentation.
create or replace function app_identity.validate_role_version(candidate_version_id uuid)
returns void language plpgsql as $$
declare
  selected_role app_identity.role%rowtype;
  missing_prerequisites text[];
  actual_capabilities text[];
  expected_capabilities text[];
begin
  select r.* into selected_role
  from app_identity.role r
  join app_identity.role_version rv
    on rv.role_id = r.id and rv.organization_id = r.organization_id
  where rv.id = candidate_version_id;

  if selected_role.id is null then return; end if;

  if not selected_role.protected and not exists (
    select 1 from app_identity.role_version_capability where role_version_id = candidate_version_id
  ) then
    raise exception 'active custom roles require at least one capability';
  end if;

  select array_agg(required.prerequisite_key order by required.prerequisite_key)
  into missing_prerequisites
  from app_identity.role_version_capability granted
  join app_identity.capability_prerequisite required
    on required.capability_key = granted.capability_key
  where granted.role_version_id = candidate_version_id
    and not exists (
      select 1 from app_identity.role_version_capability prerequisite
      where prerequisite.role_version_id = candidate_version_id
        and prerequisite.capability_key = required.prerequisite_key
    );

  if missing_prerequisites is not null then
    raise exception 'role version is missing capability prerequisites: %', missing_prerequisites;
  end if;

  if exists (
    select 1 from app_identity.role_version_capability rvc
    join app_identity.capability c on c.key = rvc.capability_key
    where rvc.role_version_id = candidate_version_id
      and c.system_only and selected_role.system_key <> 'demo'
  ) then
    raise exception 'system-only capabilities cannot be assigned to this role';
  end if;

  if selected_role.protected then
    select coalesce(array_agg(capability_key order by capability_key), array[]::text[])
    into actual_capabilities
    from app_identity.role_version_capability
    where role_version_id = candidate_version_id;
    expected_capabilities := case selected_role.system_key
      when 'clinician' then array['clinical:document']::text[]
      when 'administrator' then array[
        'admin-dashboard:read', 'catalog:publish', 'catalog:read', 'catalog:write',
        'clinical:document', 'credentials:reset', 'forms:publish', 'forms:read', 'forms:write',
        'roles:assign', 'roles:read', 'roles:write', 'sessions:read',
        'sessions:revoke', 'users:read', 'users:write'
      ]::text[]
      when 'demo' then array[
        'admin-dashboard:read', 'catalog:read', 'catalog:write', 'clinical:demo',
        'clinical:document', 'forms:read', 'forms:write', 'roles:read', 'users:read'
      ]::text[]
    end;
    if actual_capabilities <> expected_capabilities then
      raise exception 'protected role % requires its exact capability set', selected_role.system_key;
    end if;
  end if;
end;
$$;

create or replace function app_identity.seed_protected_roles(candidate_organization_id uuid)
returns void language plpgsql as $$
declare
  definition record;
  selected_role_id uuid;
  selected_version_id uuid;
begin
  for definition in
    select * from (values
      ('clinician', 'Clinician', false, true, array['clinical:document']::text[]),
      ('administrator', 'Administrator', false, true, array[
        'admin-dashboard:read', 'users:read', 'users:write', 'credentials:reset',
        'sessions:read', 'sessions:revoke', 'roles:read', 'roles:write', 'roles:assign',
        'catalog:read', 'catalog:write', 'catalog:publish',
        'forms:read', 'forms:write', 'forms:publish', 'clinical:document'
      ]::text[]),
      ('demo', 'Demo', false, true, array[
        'admin-dashboard:read', 'users:read', 'roles:read',
        'catalog:read', 'catalog:write', 'forms:read', 'forms:write',
        'clinical:document', 'clinical:demo'
      ]::text[])
    ) configured(system_key, display_name, hidden, assignable, capabilities)
  loop
    selected_role_id := gen_random_uuid();
    selected_version_id := gen_random_uuid();
    insert into app_identity.role
      (id, organization_id, system_key, display_name, protected, hidden, assignable, current_version_id,
       description, note)
    values
      (selected_role_id, candidate_organization_id, definition.system_key, definition.display_name,
       true, definition.hidden, definition.assignable, selected_version_id,
       'Protected role managed by OpenTriage', 'Initial protected-role registry');
    insert into app_identity.role_version
      (id, organization_id, role_id, version, note)
    values (selected_version_id, candidate_organization_id, selected_role_id, 1,
      'Initial protected-role registry');
    insert into app_identity.role_version_capability
      (organization_id, role_version_id, role_id, capability_key)
    select candidate_organization_id, selected_version_id, selected_role_id, capability
    from unnest(definition.capabilities) capability;
    insert into app_identity.authorization_event
      (organization_id, action, target_type, target_key, note, details)
    values (candidate_organization_id, 'role.protected_register', 'role', selected_role_id::text,
      'Initial protected-role registry', jsonb_build_object(
        'systemKey', definition.system_key,
        'displayName', definition.display_name,
        'hidden', definition.hidden,
        'assignable', definition.assignable,
        'version', 1,
        'capabilities', to_jsonb(definition.capabilities)
      ));
  end loop;
end;
$$;

do $$
declare
  administrator record;
  selected_version_id uuid;
begin
  for administrator in
    select role.id, role.organization_id, role.current_version_id,
      current_version.version + 1 next_version
    from app_identity.role role
    join app_identity.role_version current_version
      on current_version.organization_id = role.organization_id
      and current_version.role_id = role.id and current_version.id = role.current_version_id
    where role.system_key = 'administrator' and role.protected
      and not exists (
        select 1 from app_identity.role_version_capability capability
        where capability.role_version_id = role.current_version_id
          and capability.capability_key = 'clinical:document'
      )
  loop
    selected_version_id := gen_random_uuid();
    insert into app_identity.role_version
      (id, organization_id, role_id, version, note)
    values (selected_version_id, administrator.organization_id, administrator.id,
      administrator.next_version, 'Administrator includes clinical documentation');

    insert into app_identity.role_version_capability
      (organization_id, role_version_id, role_id, capability_key)
    select administrator.organization_id, selected_version_id, administrator.id, capability_key
    from (
      select capability_key
      from app_identity.role_version_capability
      where role_version_id = administrator.current_version_id
      union
      select 'clinical:document'
    ) capabilities;

    update app_identity.role
    set current_version_id = selected_version_id,
        note = 'Administrator includes clinical documentation'
    where id = administrator.id and organization_id = administrator.organization_id
      and current_version_id = administrator.current_version_id;
  end loop;
end;
$$;

revoke execute on function app_identity.seed_protected_roles(uuid),
  app_identity.validate_role_version(uuid) from public;
