-- Agency-owned report media policy. The aggregate is deliberately separate
-- from clinical report revisions and is pinned onto each new report so later
-- offline media work can prove which policy governed capture.
create table app_identity.agency_settings (
  organization_id uuid primary key references app_identity.organization(id) on delete cascade,
  report_media_allowance_bytes bigint not null default 52428800
    check (report_media_allowance_bytes between 1048576 and 2147483648),
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid,
  foreign key (organization_id, updated_by)
    references app_identity.app_user(organization_id, id)
);

comment on column app_identity.agency_settings.report_media_allowance_bytes is
  'Aggregate canonical media bytes allowed per report; defaults to 50 MiB.';

create table app_identity.agency_settings_change_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null,
  prior_revision bigint not null check (prior_revision >= 1),
  revision bigint not null check (revision >= 2),
  old_report_media_allowance_bytes bigint not null
    check (old_report_media_allowance_bytes between 1048576 and 2147483648),
  new_report_media_allowance_bytes bigint not null
    check (new_report_media_allowance_bytes between 1048576 and 2147483648),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id),
  check (revision = prior_revision + 1)
);

create index agency_settings_change_event_organization_time_idx
  on app_identity.agency_settings_change_event (organization_id, occurred_at desc, id desc);

create trigger agency_settings_change_event_append_only
before update or delete on app_identity.agency_settings_change_event
for each row execute function public.prevent_update_or_delete();

insert into app_identity.agency_settings (organization_id)
select id from app_identity.organization
on conflict (organization_id) do nothing;

create function app_identity.seed_agency_settings_for_organization()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  insert into app_identity.agency_settings (organization_id) values (new.id);
  return new;
end;
$$;

create trigger organization_seed_agency_settings
after insert on app_identity.organization
for each row execute function app_identity.seed_agency_settings_for_organization();

alter table clinical.report
  add column media_settings_revision bigint not null default 1
    check (media_settings_revision >= 1),
  add column report_media_allowance_bytes bigint not null default 52428800
    check (report_media_allowance_bytes between 1048576 and 2147483648);

create function clinical.pin_report_media_settings()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  selected_settings app_identity.agency_settings%rowtype;
begin
  select * into selected_settings
  from app_identity.agency_settings
  where organization_id = new.organization_id;

  new.media_settings_revision := coalesce(selected_settings.revision, 1);
  new.report_media_allowance_bytes := coalesce(
    selected_settings.report_media_allowance_bytes, 52428800
  );
  return new;
end;
$$;

create trigger report_pin_media_settings
before insert on clinical.report
for each row execute function clinical.pin_report_media_settings();

-- Settings use dedicated administrative authority. Existing custom roles are
-- unchanged; the protected Administrator role receives a new immutable
-- version containing the read/write pair.
alter table app_identity.capability drop constraint capability_fixed_registry;
alter table app_identity.capability add constraint capability_fixed_registry check (key in (
  'clinical:document', 'clinical:demo', 'admin-dashboard:read',
  'users:read', 'users:write', 'credentials:reset',
  'sessions:read', 'sessions:revoke', 'roles:read', 'roles:write',
  'roles:assign', 'catalog:read', 'catalog:write', 'catalog:publish',
  'forms:read', 'forms:write', 'forms:publish',
  'validation:read', 'validation:write', 'validation:publish',
  'settings:read', 'settings:write'
));

insert into app_identity.capability (key, description, system_only, administrative)
values
  ('settings:read', 'View Agency Settings', false, true),
  ('settings:write', 'Change Agency Settings', false, true);

insert into app_identity.capability_prerequisite (capability_key, prerequisite_key)
values ('settings:write', 'settings:read');

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
        'roles:assign', 'roles:read', 'roles:write', 'sessions:read', 'sessions:revoke',
        'settings:read', 'settings:write', 'users:read', 'users:write',
        'validation:publish', 'validation:read', 'validation:write'
      ]::text[]
      when 'demo' then array[
        'admin-dashboard:read', 'catalog:read', 'catalog:write', 'clinical:demo',
        'clinical:document', 'forms:read', 'forms:write', 'roles:read', 'users:read',
        'validation:read', 'validation:write'
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
        'forms:read', 'forms:write', 'forms:publish', 'clinical:document',
        'validation:read', 'validation:write', 'validation:publish',
        'settings:read', 'settings:write'
      ]::text[]),
      ('demo', 'Demo', false, true, array[
        'admin-dashboard:read', 'users:read', 'roles:read',
        'catalog:read', 'catalog:write', 'forms:read', 'forms:write',
        'clinical:document', 'clinical:demo', 'validation:read', 'validation:write'
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
  loop
    selected_version_id := gen_random_uuid();
    insert into app_identity.role_version
      (id, organization_id, role_id, version, note)
    values (selected_version_id, administrator.organization_id, administrator.id,
      administrator.next_version, 'Add dedicated Agency Settings authority');

    insert into app_identity.role_version_capability
      (organization_id, role_version_id, role_id, capability_key)
    select administrator.organization_id, selected_version_id, administrator.id, capability_key
    from (
      select capability_key
      from app_identity.role_version_capability
      where role_version_id = administrator.current_version_id
      union
      values ('settings:read'), ('settings:write')
    ) capabilities;

    update app_identity.role
    set current_version_id = selected_version_id,
        note = 'Add dedicated Agency Settings authority'
    where id = administrator.id and organization_id = administrator.organization_id
      and current_version_id = administrator.current_version_id;
  end loop;
end;
$$;

revoke all on app_identity.agency_settings,
  app_identity.agency_settings_change_event from public;
revoke execute on function app_identity.seed_agency_settings_for_organization(),
  clinical.pin_report_media_settings() from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on table app_identity.agency_settings, app_identity.agency_settings_change_event from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

revoke all on app_identity.agency_settings,
  app_identity.agency_settings_change_event from open_triage_api_runtime;

grant select, insert, update on app_identity.agency_settings
  to open_triage_api_runtime;
grant select, insert on app_identity.agency_settings_change_event
  to open_triage_api_runtime;
grant usage, select on sequence app_identity.agency_settings_change_event_id_seq
  to open_triage_api_runtime;

revoke execute on function app_identity.seed_protected_roles(uuid),
  app_identity.validate_role_version(uuid) from public;
