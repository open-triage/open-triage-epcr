-- Capabilities are a software-owned registry. Runtime authority is derived only
-- from active assignments to the current immutable version of an active role.
truncate table app_identity.user_capability;

delete from app_identity.capability;

alter table app_identity.capability
  add column system_only boolean not null default false,
  add column administrative boolean not null default false,
  add constraint capability_fixed_registry check (key in (
    'clinical:document', 'clinical:demo', 'admin-dashboard:read',
    'users:read', 'users:write', 'credentials:reset',
    'sessions:read', 'sessions:revoke', 'roles:read', 'roles:write',
    'roles:assign', 'catalog:read', 'catalog:write', 'catalog:publish',
    'forms:read', 'forms:write', 'forms:publish'
  ));

insert into app_identity.capability (key, description, system_only, administrative)
values
  ('clinical:document', 'Create and document patient care reports', false, false),
  ('clinical:demo', 'Use synthetic clinical demonstration actions', true, false),
  ('admin-dashboard:read', 'View the administrative dashboard', false, true),
  ('users:read', 'View users', false, true),
  ('users:write', 'Create and change users', false, true),
  ('credentials:reset', 'Reset user credentials', false, true),
  ('sessions:read', 'View user sessions', false, true),
  ('sessions:revoke', 'Revoke user sessions', false, true),
  ('roles:read', 'View roles and capability definitions', false, true),
  ('roles:write', 'Create and change custom roles', false, true),
  ('roles:assign', 'Assign roles to users', false, true),
  ('catalog:read', 'View catalog configuration', false, true),
  ('catalog:write', 'Author catalog configuration', false, true),
  ('catalog:publish', 'Publish and activate catalog configuration', false, true),
  ('forms:read', 'View form configuration', false, true),
  ('forms:write', 'Author form configuration', false, true),
  ('forms:publish', 'Publish and activate form configuration', false, true);

create table app_identity.capability_prerequisite (
  capability_key text not null references app_identity.capability(key),
  prerequisite_key text not null references app_identity.capability(key),
  primary key (capability_key, prerequisite_key),
  check (capability_key <> prerequisite_key)
);

insert into app_identity.capability_prerequisite (capability_key, prerequisite_key)
values
  ('users:write', 'users:read'),
  ('credentials:reset', 'users:read'),
  ('sessions:read', 'users:read'),
  ('sessions:revoke', 'sessions:read'),
  ('sessions:revoke', 'users:read'),
  ('roles:write', 'roles:read'),
  ('roles:assign', 'roles:read'),
  ('roles:assign', 'users:read'),
  ('catalog:write', 'catalog:read'),
  ('catalog:publish', 'catalog:read'),
  ('catalog:publish', 'catalog:write'),
  ('forms:write', 'forms:read'),
  ('forms:publish', 'forms:read'),
  ('forms:publish', 'forms:write');

create table app_identity.role (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  system_key text,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  protected boolean not null default false,
  hidden boolean not null default false,
  assignable boolean not null default true,
  active boolean not null default true,
  current_version_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  note text,
  unique (organization_id, id),
  unique (organization_id, system_key),
  foreign key (organization_id, created_by)
    references app_identity.app_user(organization_id, id),
  check ((system_key is null) = (not protected)),
  check (system_key is null or system_key in ('clinician', 'administrator', 'configuration-author', 'clinical-demo', 'reviewer')),
  check (system_key <> 'reviewer' or (hidden and not assignable)),
  check (system_key = 'reviewer' or not hidden)
);

create unique index role_active_display_name_idx
  on app_identity.role (organization_id, lower(display_name)) where active;

create table app_identity.role_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  role_id uuid not null,
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  created_by uuid,
  note text,
  unique (organization_id, id, role_id),
  unique (role_id, version),
  foreign key (organization_id, created_by)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, role_id)
    references app_identity.role(organization_id, id)
    deferrable initially deferred
);

alter table app_identity.role add constraint role_current_version_fkey
  foreign key (organization_id, current_version_id, id)
  references app_identity.role_version(organization_id, id, role_id)
  deferrable initially deferred;

create table app_identity.role_version_capability (
  organization_id uuid not null,
  role_version_id uuid not null,
  role_id uuid not null,
  capability_key text not null references app_identity.capability(key),
  primary key (role_version_id, capability_key),
  foreign key (organization_id, role_version_id, role_id)
    references app_identity.role_version(organization_id, id, role_id)
    deferrable initially deferred
);

create index role_version_capability_role_idx
  on app_identity.role_version_capability (organization_id, role_id, role_version_id);
create index role_version_capability_key_idx
  on app_identity.role_version_capability (capability_key);

create table app_identity.user_role_assignment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  role_id uuid not null,
  assigned_at timestamptz not null default now(),
  assigned_by uuid,
  ended_at timestamptz,
  ended_by uuid,
  note text,
  unique (organization_id, id),
  foreign key (organization_id, user_id)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, role_id)
    references app_identity.role(organization_id, id),
  foreign key (organization_id, assigned_by)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, ended_by)
    references app_identity.app_user(organization_id, id),
  check ((ended_at is null) = (ended_by is null)),
  check (ended_at is null or ended_at >= assigned_at)
);

create unique index user_role_assignment_current_idx
  on app_identity.user_role_assignment (user_id, role_id) where ended_at is null;
create index user_role_assignment_current_role_idx
  on app_identity.user_role_assignment (organization_id, role_id, user_id) where ended_at is null;

create table app_identity.authorization_event (
  id bigint generated always as identity primary key,
  organization_id uuid references app_identity.organization(id),
  actor_id uuid,
  action text not null check (action in (
    'capability.register', 'capability.change',
    'role.protected_register', 'role.version_activate'
  )),
  target_type text not null check (target_type in ('capability', 'role', 'role_version')),
  target_key text not null,
  occurred_at timestamptz not null default now(),
  note text,
  details jsonb not null default '{}'::jsonb,
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id),
  check (details::text !~* '"(password|password_verifier|token|csrf|secret|recovery_value)"[[:space:]]*:')
);

create index authorization_event_organization_time_idx
  on app_identity.authorization_event (organization_id, occurred_at desc, id desc);
create index authorization_event_target_idx
  on app_identity.authorization_event (target_type, target_key, occurred_at desc);

create trigger authorization_event_append_only
before update or delete on app_identity.authorization_event
for each row execute function public.prevent_update_or_delete();

create function app_identity.audit_capability_change()
returns trigger language plpgsql as $$
begin
  insert into app_identity.authorization_event
    (action, target_type, target_key, note, details)
  values (
    case when tg_op = 'INSERT' then 'capability.register' else 'capability.change' end,
    'capability', coalesce(new.key, old.key),
    nullif(current_setting('open_triage.authorization_note', true), ''),
    jsonb_build_object(
      'operation', lower(tg_op),
      'before', case when tg_op in ('UPDATE', 'DELETE') then
        jsonb_build_object('description', old.description, 'systemOnly', old.system_only,
          'administrative', old.administrative) else null end,
      'after', case when tg_op in ('INSERT', 'UPDATE') then
        jsonb_build_object('description', new.description, 'systemOnly', new.system_only,
          'administrative', new.administrative) else null end
    )
  );
  return coalesce(new, old);
end;
$$;

create trigger capability_change_audit
after insert or update or delete on app_identity.capability
for each row execute function app_identity.audit_capability_change();

create function app_identity.audit_role_version_activation()
returns trigger language plpgsql as $$
declare selected_version app_identity.role_version%rowtype;
begin
  if new.current_version_id = old.current_version_id then return new; end if;
  select * into selected_version from app_identity.role_version where id = new.current_version_id;
  insert into app_identity.authorization_event
    (organization_id, actor_id, action, target_type, target_key, note, details)
  values (new.organization_id, selected_version.created_by, 'role.version_activate',
    'role_version', new.current_version_id::text, selected_version.note,
    jsonb_build_object('roleId', new.id, 'priorVersionId', old.current_version_id,
      'version', selected_version.version));
  return new;
end;
$$;

create trigger role_version_activation_audit
after update of current_version_id on app_identity.role
for each row execute function app_identity.audit_role_version_activation();

create trigger role_version_immutable
before update or delete on app_identity.role_version
for each row execute function public.prevent_update_or_delete();
create trigger role_version_capability_immutable
before update or delete on app_identity.role_version_capability
for each row execute function public.prevent_update_or_delete();
create trigger capability_prerequisite_immutable
before update or delete on app_identity.capability_prerequisite
for each row execute function public.prevent_update_or_delete();

create function app_identity.protect_authorization_definitions()
returns trigger language plpgsql as $$
begin
  if old.protected and (
    tg_op = 'DELETE'
    or (to_jsonb(new) - array['current_version_id', 'note'])
      <> (to_jsonb(old) - array['current_version_id', 'note'])
  ) then
    raise exception 'protected role % is immutable', old.system_key;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protected_role_immutable
before update or delete on app_identity.role
for each row execute function app_identity.protect_authorization_definitions();

create function app_identity.validate_role_assignment()
returns trigger language plpgsql as $$
begin
  if new.ended_at is null and not exists (
    select 1 from app_identity.role
    where id = new.role_id and organization_id = new.organization_id
      and active and assignable
  ) then
    raise exception 'role is inactive or unassignable';
  end if;
  return new;
end;
$$;

create trigger user_role_assignment_valid
before insert or update of role_id, organization_id, ended_at
on app_identity.user_role_assignment
for each row execute function app_identity.validate_role_assignment();

create function app_identity.validate_role_version(candidate_version_id uuid)
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
      and c.system_only and selected_role.system_key <> 'clinical-demo'
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
        'credentials:reset', 'forms:publish', 'forms:read', 'forms:write',
        'roles:assign', 'roles:read', 'roles:write', 'sessions:read',
        'sessions:revoke', 'users:read', 'users:write'
      ]::text[]
      when 'configuration-author' then array[
        'admin-dashboard:read', 'catalog:read', 'catalog:write', 'forms:read',
        'forms:write', 'roles:read', 'users:read'
      ]::text[]
      when 'clinical-demo' then array['clinical:demo', 'clinical:document']::text[]
      when 'reviewer' then array[]::text[]
    end;
    if actual_capabilities <> expected_capabilities then
      raise exception 'protected role % requires its exact capability set', selected_role.system_key;
    end if;
  end if;
end;
$$;

create function app_identity.validate_role_version_trigger()
returns trigger language plpgsql as $$
begin
  perform app_identity.validate_role_version(coalesce(new.role_version_id, old.role_version_id));
  return coalesce(new, old);
end;
$$;

create constraint trigger role_version_capabilities_valid
after insert or update or delete on app_identity.role_version_capability
deferrable initially deferred for each row
execute function app_identity.validate_role_version_trigger();

create function app_identity.validate_current_role_version_trigger()
returns trigger language plpgsql as $$
begin
  perform app_identity.validate_role_version(new.current_version_id);
  return new;
end;
$$;

create constraint trigger role_current_version_valid
after insert or update of current_version_id on app_identity.role
deferrable initially deferred for each row
execute function app_identity.validate_current_role_version_trigger();

create function app_identity.seed_protected_roles(candidate_organization_id uuid)
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
        'forms:read', 'forms:write', 'forms:publish'
      ]::text[]),
      ('configuration-author', 'Configuration Author', false, true, array[
        'admin-dashboard:read', 'users:read', 'roles:read',
        'catalog:read', 'catalog:write', 'forms:read', 'forms:write'
      ]::text[]),
      ('clinical-demo', 'Clinical Demo', false, true, array['clinical:document', 'clinical:demo']::text[]),
      ('reviewer', 'Reviewer', true, false, array[]::text[])
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

select app_identity.seed_protected_roles(id) from app_identity.organization;

create function app_identity.seed_protected_roles_for_organization()
returns trigger language plpgsql as $$
begin
  perform app_identity.seed_protected_roles(new.id);
  return new;
end;
$$;

create trigger organization_seed_protected_roles
after insert on app_identity.organization
for each row execute function app_identity.seed_protected_roles_for_organization();

insert into app_identity.authorization_event
  (action, target_type, target_key, note, details)
select 'capability.register', 'capability', key, 'Initial fixed capability registry',
  jsonb_build_object('description', description, 'systemOnly', system_only, 'administrative', administrative)
from app_identity.capability;

create function app_identity.user_has_capability(
  candidate_user_id uuid,
  candidate_organization_id uuid,
  candidate_capability text
) returns boolean language sql stable security invoker as $$
  select exists (
    select 1
    from app_identity.app_user u
    join app_identity.user_role_assignment ura
      on ura.organization_id = u.organization_id and ura.user_id = u.id and ura.ended_at is null
    join app_identity.role r
      on r.organization_id = ura.organization_id and r.id = ura.role_id
      and r.active and r.assignable
    join app_identity.role_version rv
      on rv.organization_id = r.organization_id and rv.role_id = r.id and rv.id = r.current_version_id
    join app_identity.role_version_capability rvc
      on rvc.organization_id = rv.organization_id and rvc.role_id = rv.role_id
      and rvc.role_version_id = rv.id
    where u.id = candidate_user_id
      and u.organization_id = candidate_organization_id
      and u.active
      and rvc.capability_key = candidate_capability
  );
$$;

-- Move the existing retention guard off the retired direct-grant table without
-- duplicating the security-definer function's clinical deletion implementation.
do $$
declare
  function_definition text;
  rewritten_definition text;
  legacy_authorization constant text := $legacy$
  join app_identity.user_capability capability on capability.user_id = u.id
  where u.id = candidate_admin_user_id
    and u.organization_id = selected_batch.organization_id
    and u.active
    and capability.capability_key = 'installation:administer';$legacy$;
  role_authorization constant text := $role$
  where u.id = candidate_admin_user_id
    and u.organization_id = selected_batch.organization_id
    and u.active
    and app_identity.user_has_capability(
      u.id, selected_batch.organization_id, 'roles:write'
    );$role$;
begin
  select pg_get_functiondef('retention.delete_verified_batch(uuid,uuid)'::regprocedure)
  into function_definition;
  rewritten_definition := replace(function_definition, legacy_authorization, role_authorization);
  if rewritten_definition = function_definition then
    raise exception 'could not replace legacy retention authorization';
  end if;
  execute rewritten_definition;
end;
$$;

-- Direct user capability grants are retired rather than retained as a dormant
-- compatibility path.
drop table app_identity.user_capability;

revoke all on app_identity.capability, app_identity.capability_prerequisite,
  app_identity.role, app_identity.role_version, app_identity.role_version_capability,
  app_identity.user_role_assignment, app_identity.authorization_event from public;
revoke execute on function app_identity.seed_protected_roles(uuid),
  app_identity.seed_protected_roles_for_organization(),
  app_identity.validate_role_version(uuid),
  app_identity.validate_role_version_trigger(),
  app_identity.validate_current_role_version_trigger(),
  app_identity.protect_authorization_definitions(),
  app_identity.validate_role_assignment(),
  app_identity.audit_capability_change(),
  app_identity.audit_role_version_activation() from public;
