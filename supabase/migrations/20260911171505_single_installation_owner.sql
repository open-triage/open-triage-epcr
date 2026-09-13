-- Ownership is separate from runtime roles: it identifies the one accountable
-- operator while Administrator remains the explicit source of admin authority.
create table app_identity.installation_owner (
  organization_id uuid primary key references app_identity.organization(id),
  user_id uuid not null unique,
  established_at timestamptz not null default now(),
  established_by_operator_id text not null check (
    char_length(btrim(established_by_operator_id)) between 1 and 200
    and established_by_operator_id !~ '[[:cntrl:]]'
  ),
  foreign key (organization_id, user_id)
    references app_identity.app_user(organization_id, id)
);

create table app_identity.operator_identity_event (
  id bigint generated always as identity primary key,
  command text not null check (command in (
    'owner.bootstrap', 'owner.reset_password', 'user.reset_password'
  )),
  target_organization_id uuid,
  target_user_id uuid,
  operator_id text not null check (
    char_length(btrim(operator_id)) between 1 and 200 and operator_id !~ '[[:cntrl:]]'
  ),
  os_account text not null check (
    char_length(btrim(os_account)) between 1 and 200 and os_account !~ '[[:cntrl:]]'
  ),
  host text not null check (
    char_length(btrim(host)) between 1 and 255 and host !~ '[[:cntrl:]]'
  ),
  occurred_at timestamptz not null default now(),
  result text not null check (result in ('succeeded', 'failed')),
  details jsonb not null default '{}'::jsonb,
  check (target_organization_id is not null or target_user_id is not null),
  check (details::text !~* '"(password|password_verifier|token|csrf|secret|recovery_value)"[[:space:]]*:')
);

create index operator_identity_event_organization_time_idx
  on app_identity.operator_identity_event (target_organization_id, occurred_at desc, id desc);
create index operator_identity_event_user_time_idx
  on app_identity.operator_identity_event (target_user_id, occurred_at desc, id desc);

create trigger operator_identity_event_append_only
before update or delete on app_identity.operator_identity_event
for each row execute function public.prevent_update_or_delete();

create function app_identity.validate_installation_owner()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1
    from app_identity.app_user u
    join app_identity.user_role_assignment assignment
      on assignment.organization_id = u.organization_id
      and assignment.user_id = u.id and assignment.ended_at is null
    join app_identity.role role
      on role.organization_id = assignment.organization_id and role.id = assignment.role_id
    where u.organization_id = new.organization_id and u.id = new.user_id and u.active
      and role.system_key = 'administrator' and role.protected and role.active and role.assignable
  ) then
    raise exception 'installation owner must be an active Administrator';
  end if;
  return new;
end;
$$;

create trigger installation_owner_valid
before insert or update of organization_id, user_id on app_identity.installation_owner
for each row execute function app_identity.validate_installation_owner();

create function app_identity.protect_installation_owner_row()
returns trigger language plpgsql as $$
begin
  raise exception 'installation ownership cannot be removed after setup';
end;
$$;

create trigger installation_owner_not_deleted
before delete on app_identity.installation_owner
for each row execute function app_identity.protect_installation_owner_row();

create function app_identity.protect_active_owner_user()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from app_identity.installation_owner owner_record
    where owner_record.organization_id = old.organization_id and owner_record.user_id = old.id
  ) and (tg_op = 'DELETE' or not new.active or new.organization_id <> old.organization_id) then
    raise exception 'installation owner cannot be disabled, moved, or deleted';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger active_owner_user_protected
before update of active, organization_id or delete on app_identity.app_user
for each row execute function app_identity.protect_active_owner_user();

create function app_identity.protect_owner_local_credential()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from app_identity.installation_owner owner_record
    where owner_record.user_id = old.user_id
  ) and (tg_op = 'DELETE' or new.user_id <> old.user_id) then
    raise exception 'installation owner credential cannot be removed or reassigned';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger owner_local_credential_protected
before update of user_id or delete on app_identity.local_credential
for each row execute function app_identity.protect_owner_local_credential();

create function app_identity.protect_owner_administrator_assignment()
returns trigger language plpgsql as $$
declare
  protected_assignment boolean;
begin
  select exists (
    select 1
    from app_identity.installation_owner owner_record
    join app_identity.role role
      on role.organization_id = old.organization_id and role.id = old.role_id
    where owner_record.organization_id = old.organization_id
      and owner_record.user_id = old.user_id
      and role.system_key = 'administrator'
      and old.ended_at is null
  ) into protected_assignment;

  if protected_assignment and (
    tg_op = 'DELETE' or new.ended_at is not null or new.organization_id <> old.organization_id
    or new.user_id <> old.user_id or new.role_id <> old.role_id
  ) then
    raise exception 'installation owner Administrator assignment cannot be removed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger owner_administrator_assignment_protected
before update or delete on app_identity.user_role_assignment
for each row execute function app_identity.protect_owner_administrator_assignment();

-- An organization may have zero owners only while setup is incomplete. Once the
-- one owner row exists, its primary key and non-delete trigger prevent both
-- multiple owners and a return to zero. All role-derived access is inert until then.
create or replace function app_identity.user_has_capability(
  candidate_user_id uuid,
  candidate_organization_id uuid,
  candidate_capability text
) returns boolean language sql stable security invoker as $$
  select exists (
    select 1
    from app_identity.installation_owner owner_record
    join app_identity.app_user u on u.organization_id = owner_record.organization_id
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
    where owner_record.organization_id = candidate_organization_id
      and u.id = candidate_user_id
      and u.organization_id = candidate_organization_id
      and u.active
      and rvc.capability_key = candidate_capability
  );
$$;

revoke all on app_identity.installation_owner, app_identity.operator_identity_event from public;
revoke execute on function app_identity.validate_installation_owner(),
  app_identity.protect_installation_owner_row(),
  app_identity.protect_active_owner_user(),
  app_identity.protect_owner_local_credential(),
  app_identity.protect_owner_administrator_assignment() from public;
