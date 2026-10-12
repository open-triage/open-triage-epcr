-- Ordinary identities belong to a family. Installation administrators reserve
-- their names globally, including old names, so portal login is unambiguous.
create table app_identity.installation_superadmin (
  user_id uuid primary key references app_identity.app_user(id),
  established_at timestamptz not null default now(),
  established_by_operator_id text not null check (char_length(btrim(established_by_operator_id)) between 1 and 200
    and established_by_operator_id !~ '[[:cntrl:]]')
);
revoke all on app_identity.installation_superadmin from public, open_triage_api_runtime;
grant select on app_identity.installation_superadmin to open_triage_api_runtime;

create function app_identity.is_installation_superadmin(candidate uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select app_identity.is_installation_owner(candidate) or exists (
    select 1 from app_identity.installation_superadmin administrator
    join app_identity.app_user account on account.id = administrator.user_id
    where account.id = candidate and account.active);
$$;
revoke all on function app_identity.is_installation_superadmin(uuid) from public;
grant execute on function app_identity.is_installation_superadmin(uuid) to open_triage_api_runtime;

alter table app_identity.username_reservation add column family_id uuid references app_identity.organization(id);
alter table app_identity.username_reservation disable trigger username_reservation_append_only;
update app_identity.username_reservation reservation set family_id = app_identity.organization_group(account.organization_id)
  from app_identity.app_user account where account.id = reservation.user_id;
alter table app_identity.username_reservation enable trigger username_reservation_append_only;
alter table app_identity.username_reservation alter column family_id set not null;
alter table app_identity.username_reservation drop constraint username_reservation_pkey,
  add primary key (family_id, username);
create index username_reservation_name_idx on app_identity.username_reservation(username);
alter table app_identity.local_credential drop constraint local_credential_username_key;

create table app_identity.global_username_reservation (
  username text primary key,
  user_id uuid not null references app_identity.app_user(id),
  reserved_at timestamptz not null default now(),
  foreign key (user_id, username) references app_identity.username_reservation(user_id, username)
);
create index global_username_reservation_user_idx on app_identity.global_username_reservation(user_id);
revoke all on app_identity.global_username_reservation from public, open_triage_api_runtime;
grant select, insert on app_identity.global_username_reservation to open_triage_api_runtime;
create trigger global_username_reservation_append_only before update or delete on app_identity.global_username_reservation
  for each row execute function public.prevent_update_or_delete();

-- Lock by name for both family reservations and global promotion. This closes
-- the race between an ordinary signup and a simultaneous administrator signup.
create function app_identity.validate_username_reservation()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.username, 76124));
  if tg_table_name = 'global_username_reservation' then
    if exists (select 1 from app_identity.username_reservation where username = new.username and user_id <> new.user_id) then
      raise unique_violation using message = 'username is already reserved by another account';
    end if;
  else
    if new.family_id is distinct from (select app_identity.organization_group(organization_id)
      from app_identity.app_user where id = new.user_id) then
      raise exception 'Username family must match the account family';
    end if;
    if exists (select 1 from app_identity.global_username_reservation where username = new.username and user_id <> new.user_id) then
      raise unique_violation using message = 'username is globally reserved';
    end if;
  end if;
  return new;
end;
$$;
create trigger username_reservation_valid before insert on app_identity.username_reservation
  for each row execute function app_identity.validate_username_reservation();
create trigger global_username_reservation_valid before insert on app_identity.global_username_reservation
  for each row execute function app_identity.validate_username_reservation();

create or replace function app_identity.reserve_local_username()
returns trigger language plpgsql set search_path = '' as $$
declare family uuid;
begin
  select app_identity.organization_group(organization_id) into family from app_identity.app_user where id = new.user_id;
  insert into app_identity.username_reservation (family_id, username, user_id)
    values (family, new.username, new.user_id) on conflict (family_id, username) do nothing;
  if not exists (select 1 from app_identity.username_reservation
    where family_id = family and username = new.username and user_id = new.user_id) then
    raise unique_violation using message = 'username is permanently reserved in this organization family';
  end if;
  -- Include inactive administrators: disabling an account never frees its name.
  if exists (select 1 from app_identity.installation_owner where user_id = new.user_id)
    or exists (select 1 from app_identity.installation_superadmin where user_id = new.user_id) then
    insert into app_identity.global_username_reservation(username, user_id)
      values (new.username, new.user_id) on conflict (username) do nothing;
  end if;
  return new;
end;
$$;

create function app_identity.reserve_administrator_usernames()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into app_identity.global_username_reservation(username, user_id, reserved_at)
    select username, user_id, reserved_at from app_identity.username_reservation
    where user_id = new.user_id order by username on conflict (username) do nothing;
  return new;
end;
$$;
create trigger owner_reserve_global_names after insert or update of user_id on app_identity.installation_owner
  for each row execute function app_identity.reserve_administrator_usernames();
create trigger superadmin_reserve_global_names after insert on app_identity.installation_superadmin
  for each row execute function app_identity.reserve_administrator_usernames();
insert into app_identity.global_username_reservation(username, user_id, reserved_at)
  select reservation.username, reservation.user_id, reservation.reserved_at
  from app_identity.username_reservation reservation join app_identity.installation_owner owner_record
    on owner_record.user_id = reservation.user_id;

alter table app_identity.operator_identity_event drop constraint operator_identity_event_command_check,
  add constraint operator_identity_event_command_check check (command in (
    'owner.bootstrap', 'owner.reset_password', 'user.reset_password', 'superadmin.create'));

revoke all on function app_identity.validate_username_reservation(), app_identity.reserve_administrator_usernames() from public;
grant execute on function app_identity.validate_username_reservation(), app_identity.reserve_administrator_usernames()
  to open_triage_api_runtime;

create or replace function app_identity.user_can_access_organization(candidate_user uuid, candidate_organization uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app_identity.app_user account
    join app_identity.organization agency on agency.id = candidate_organization and agency.active
    join app_identity.organization root on root.id = coalesce(agency.parent_organization_id, agency.id) and root.active
    where account.id = candidate_user and account.active and
      (app_identity.organization_group(account.organization_id) = root.id
        or app_identity.is_installation_superadmin(account.id)));
$$;

create or replace function app_identity.expand_organization_users()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Serialize agency/account creation so concurrent inserts cannot miss each other.
  perform pg_catalog.pg_advisory_xact_lock(691631722);
  insert into app_identity.organization_user (organization_id, user_id)
  select agency.id, account.id from app_identity.organization agency cross join app_identity.app_user account
  where (app_identity.organization_group(account.organization_id) = app_identity.organization_group(agency.id)
    or app_identity.is_installation_superadmin(account.id))
    and (tg_table_name in ('installation_owner', 'installation_superadmin') or
      (tg_table_name = 'organization' and agency.id = (to_jsonb(new)->>'id')::uuid) or
      (tg_table_name = 'app_user' and account.id = (to_jsonb(new)->>'id')::uuid))
  on conflict do nothing;
  return new;
end;
$$;

create or replace function app_identity.user_has_capability(
  candidate_user_id uuid, candidate_organization_id uuid, candidate_capability text
) returns boolean language sql stable security invoker as $$
  select exists (select 1 from app_identity.capability where key = candidate_capability)
    and app_identity.user_can_access_organization(candidate_user_id, candidate_organization_id)
    and (app_identity.is_installation_superadmin(candidate_user_id) or
      (exists (select 1 from app_identity.installation_owner) and exists (
        select 1 from app_identity.user_role_assignment assignment
        join app_identity.role role on role.id = assignment.role_id
          and role.organization_id = assignment.organization_id and role.active and role.assignable
        join app_identity.role_version_capability definition on definition.role_version_id = role.current_version_id
          and definition.role_id = role.id and definition.organization_id = role.organization_id
        where assignment.user_id = candidate_user_id and assignment.ended_at is null
          and app_identity.organization_group(assignment.organization_id) = app_identity.organization_group(candidate_organization_id)
          and definition.capability_key = candidate_capability)));
$$;

create trigger superadmin_expand_organizations after insert on app_identity.installation_superadmin
  for each row execute function app_identity.expand_organization_users();
