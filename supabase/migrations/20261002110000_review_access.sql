-- Review report scope is independent of identifying access and administrative UI access.
alter table app_identity.capability drop constraint capability_fixed_registry;
alter table app_identity.capability add constraint capability_fixed_registry check (key in (
  'clinical:document', 'clinical:demo', 'admin-dashboard:read',
  'users:read', 'users:write', 'credentials:reset',
  'sessions:read', 'sessions:revoke', 'roles:read', 'roles:write',
  'roles:assign', 'catalog:read', 'catalog:write', 'catalog:publish',
  'forms:read', 'forms:write', 'forms:publish',
  'validation:read', 'validation:write', 'validation:publish',
  'settings:read', 'settings:write',
  'review:self', 'review:all', 'review:admin', 'review:identifying'
));

insert into app_identity.capability (key, description, system_only, administrative) values
  ('review:self', 'Review own documented reports', false, false),
  ('review:all', 'Review reports throughout the organization', false, false),
  ('review:admin', 'Manage review workflow and configuration', false, true),
  ('review:identifying', 'See identifying content within review report scope', false, false);

insert into app_identity.capability_prerequisite (capability_key, prerequisite_key) values
  ('review:admin', 'review:all');

alter table app_identity.role drop constraint role_system_key_check;
alter table app_identity.role add constraint role_system_key_check
  check (system_key is null or system_key in
    ('clinician', 'administrator', 'demo', 'reviewer', 'review-administrator'));

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
      when 'clinician' then array['clinical:document', 'review:self']::text[]
      when 'administrator' then array[
        'admin-dashboard:read', 'catalog:publish', 'catalog:read', 'catalog:write',
        'clinical:document', 'credentials:reset', 'forms:publish', 'forms:read', 'forms:write',
        'roles:assign', 'roles:read', 'roles:write', 'sessions:read', 'sessions:revoke',
        'settings:read', 'settings:write', 'users:read', 'users:write',
        'validation:publish', 'validation:read', 'validation:write'
      ]::text[]
      when 'reviewer' then array['review:all']::text[]
      when 'review-administrator' then array['review:admin', 'review:all']::text[]
      when 'demo' then array[
        'admin-dashboard:read', 'catalog:read', 'catalog:write', 'clinical:demo',
        'clinical:document', 'forms:read', 'forms:write', 'review:admin',
        'review:all', 'review:identifying', 'roles:read', 'settings:read',
        'users:read', 'validation:read', 'validation:write'
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
      ('clinician', 'Clinician', false, true, array['clinical:document', 'review:self']::text[]),
      ('administrator', 'Administrator', false, true, array[
        'admin-dashboard:read', 'users:read', 'users:write', 'credentials:reset',
        'sessions:read', 'sessions:revoke', 'roles:read', 'roles:write', 'roles:assign',
        'catalog:read', 'catalog:write', 'catalog:publish',
        'forms:read', 'forms:write', 'forms:publish', 'clinical:document',
        'validation:read', 'validation:write', 'validation:publish',
        'settings:read', 'settings:write'
      ]::text[]),
      ('reviewer', 'Reviewer', false, true, array['review:all']::text[]),
      ('review-administrator', 'Review administrator', false, true, array['review:all', 'review:admin']::text[]),
      ('demo', 'Demo', false, true, array[
        'admin-dashboard:read', 'users:read', 'roles:read', 'settings:read',
        'catalog:read', 'catalog:write', 'forms:read', 'forms:write',
        'clinical:document', 'clinical:demo', 'validation:read', 'validation:write',
        'review:all', 'review:admin', 'review:identifying'
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
  selected_role record;
  next_version_id uuid;
  additions text[];
begin
  for selected_role in
    select r.id, r.organization_id, r.system_key, r.current_version_id,
      v.version as current_version
    from app_identity.role r
    join app_identity.role_version v on v.id = r.current_version_id
    where r.protected and r.system_key in ('clinician', 'demo')
  loop
    additions := case selected_role.system_key
      when 'clinician' then array['review:self']::text[]
      else array['review:all', 'review:admin', 'review:identifying']::text[] end;
    next_version_id := gen_random_uuid();
    insert into app_identity.role_version
      (id, organization_id, role_id, version, note)
    values (next_version_id, selected_role.organization_id, selected_role.id,
      selected_role.current_version + 1, 'Enable Review');
    insert into app_identity.role_version_capability
      (organization_id, role_version_id, role_id, capability_key)
    select selected_role.organization_id, next_version_id, selected_role.id, capability_key
    from (
      select capability_key from app_identity.role_version_capability
      where role_version_id = selected_role.current_version_id
      union select unnest(additions)
    ) capability_set;
    update app_identity.role set current_version_id = next_version_id,
      note = 'Enable Review' where id = selected_role.id;
  end loop;
end;
$$;

-- This updates existing organizations as well as the seed function for future ones.
do $$
declare
  organization_record record;
  role_key text;
  role_id uuid;
  version_id uuid;
  role_caps text[];
begin
  for organization_record in select id from app_identity.organization loop
    foreach role_key in array array['reviewer', 'review-administrator'] loop
      role_caps := case role_key when 'reviewer' then array['review:all']::text[]
        else array['review:all', 'review:admin']::text[] end;
      role_id := gen_random_uuid();
      version_id := gen_random_uuid();
      insert into app_identity.role
        (id, organization_id, system_key, display_name, protected, hidden,
         assignable, current_version_id, description, note)
      values (role_id, organization_record.id, role_key,
        case role_key when 'reviewer' then 'Reviewer' else 'Review administrator' end,
        true, false, true, version_id, 'Protected role managed by OpenTriage',
        'Enable Review');
      insert into app_identity.role_version
        (id, organization_id, role_id, version, note)
      values (version_id, organization_record.id, role_id, 1, 'Enable Review');
      insert into app_identity.role_version_capability
        (organization_id, role_version_id, role_id, capability_key)
      select organization_record.id, version_id, role_id, unnest(role_caps);
    end loop;
  end loop;
end;
$$;

create index report_review_scope_idx on clinical.report
  (organization_id, synthetic, documenting_user_id, id) where status = 'signed';

revoke execute on function app_identity.seed_protected_roles(uuid),
  app_identity.validate_role_version(uuid) from public;
