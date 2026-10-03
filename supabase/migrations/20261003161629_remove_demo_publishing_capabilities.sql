-- Demo supports authoring workflows without publishing access.
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
      and c.system_only and (selected_role.system_key is null or selected_role.system_key not in ('administrator', 'demo'))
  ) then
    raise exception 'system-only capabilities cannot be assigned to this role';
  end if;

  if selected_role.protected then
    select coalesce(array_agg(capability_key order by capability_key), array[]::text[])
    into actual_capabilities
    from app_identity.role_version_capability
    where role_version_id = candidate_version_id;
    expected_capabilities := case selected_role.system_key
      when 'clinician' then array['clinical:document', 'review:self']::text[]
      when 'administrator' then (select array_agg(key order by key) from app_identity.capability)
      when 'reviewer' then array['review:all']::text[]
      when 'review-administrator' then array['review:admin', 'review:all']::text[]
      when 'demo' then (select array_agg(key order by key) from app_identity.capability
        where key not like '%:publish')
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
      ('clinician', 'Clinician', false, true, array['clinical:document', 'review:self']::text[]),
      ('administrator', 'Administrator', false, true, (select array_agg(key order by key) from app_identity.capability)),
      ('reviewer', 'Reviewer', false, true, array['review:all']::text[]),
      ('review-administrator', 'Review administrator', false, true, array['review:all', 'review:admin']::text[]),
      ('demo', 'Demo', false, true, (select array_agg(key order by key) from app_identity.capability
        where key not like '%:publish'))
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

-- Preserve prior role versions and immediately remove publishing from existing assignees.
do $$
declare
  selected_role record;
  next_version_id uuid;
begin
  for selected_role in
    select r.id, r.organization_id, max(v.version) version
    from app_identity.role r
    join app_identity.role_version v on v.role_id = r.id and v.organization_id = r.organization_id
    where r.protected and r.system_key = 'demo'
    group by r.id
  loop
    next_version_id := gen_random_uuid();
    insert into app_identity.role_version (id, organization_id, role_id, version, note)
    values (next_version_id, selected_role.organization_id, selected_role.id, selected_role.version + 1,
      'Remove publishing permissions from Demo');
    insert into app_identity.role_version_capability (organization_id, role_version_id, role_id, capability_key)
    select selected_role.organization_id, next_version_id, selected_role.id, key
    from app_identity.capability where key not like '%:publish';
    update app_identity.role set current_version_id = next_version_id,
      note = 'Remove publishing permissions from Demo'
    where id = selected_role.id;
    insert into app_identity.authorization_event
      (organization_id, action, target_type, target_key, note, details)
    values (selected_role.organization_id, 'role.protected_register', 'role', selected_role.id::text,
      'Remove publishing permissions from Demo',
      jsonb_build_object('version', selected_role.version + 1,
        'capabilities', (select jsonb_agg(key order by key) from app_identity.capability
          where key not like '%:publish')));
  end loop;
end;
$$;

revoke execute on function app_identity.seed_protected_roles(uuid), app_identity.validate_role_version(uuid) from public;
