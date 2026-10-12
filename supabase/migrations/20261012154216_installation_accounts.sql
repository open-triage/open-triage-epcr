-- Installation identities have no agency membership. Historical organization_user
-- rows remain for clinical/audit foreign keys; they never confer live authority.
alter table app_identity.app_user alter column organization_id drop not null;
alter table app_identity.app_user add column account_scope text not null default 'agency'
  check (account_scope in ('agency', 'installation'));

create or replace function app_identity.validate_account_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.account_scope = 'installation' then
    if new.organization_id is not null then raise exception 'Installation accounts cannot belong to an agency'; end if;
  elsif new.organization_id is null or app_identity.organization_group(new.organization_id) is distinct from new.organization_id then
    raise exception 'Staff accounts must belong to the parent agency';
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id
    and not (new.account_scope = 'installation' and new.organization_id is null) then
    raise exception 'An existing account cannot be moved between agency groups';
  end if;
  return new;
end;
$$;
drop trigger account_group_valid on app_identity.app_user;
create trigger account_group_valid before insert or update of organization_id, account_scope on app_identity.app_user
  for each row execute function app_identity.validate_account_group();

create or replace function app_identity.protect_active_owner_user()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform 1 from app_identity.installation_owner for update;
  if exists (select 1 from app_identity.installation_owner where user_id=old.id)
    and (tg_op='DELETE' or not new.active) then
    raise exception 'installation owner cannot be disabled or deleted';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

-- Preserve permanent family reservations while allowing installation names to
-- have no family. All installation names are additionally reserved globally.
alter table app_identity.username_reservation drop constraint username_reservation_pkey;
alter table app_identity.username_reservation alter column family_id drop not null;
alter table app_identity.username_reservation add constraint username_reservation_family_name_key
  unique nulls not distinct (family_id, username);
create or replace function app_identity.reserve_local_username()
returns trigger language plpgsql set search_path = '' as $$
declare family uuid; installation boolean;
begin
  select app_identity.organization_group(organization_id), account_scope='installation'
    into family, installation from app_identity.app_user where id=new.user_id;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.username, 76124));
  if not exists (select 1 from app_identity.username_reservation where user_id=new.user_id and username=new.username) then
    insert into app_identity.username_reservation(family_id,username,user_id)
      values(family,new.username,new.user_id) on conflict(family_id,username) do nothing;
    if not exists(select 1 from app_identity.username_reservation where user_id=new.user_id and username=new.username) then
      raise unique_violation using message='username is permanently reserved in this organization family';
    end if;
  end if;
  if installation or exists(select 1 from app_identity.installation_owner where user_id=new.user_id)
    or exists(select 1 from app_identity.installation_superadmin where user_id=new.user_id) then
    insert into app_identity.global_username_reservation(username,user_id)
      values(new.username,new.user_id) on conflict(username) do nothing;
  end if;
  return new;
end;
$$;

-- Owner identity is installation-wide; transfer records retain their agency as
-- historical nomination context, not as an ownership boundary.
drop trigger installation_owner_valid on app_identity.installation_owner;
alter table app_identity.installation_owner drop column organization_id;
alter table app_identity.installation_owner add primary key (user_id),
  add foreign key (user_id) references app_identity.app_user(id);
create or replace function app_identity.validate_installation_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from app_identity.app_user where id=new.user_id and active) then
    raise exception 'installation owner must be an active user';
  end if;
  return new;
end;
$$;
create trigger installation_owner_valid before insert or update of user_id on app_identity.installation_owner
  for each row execute function app_identity.validate_installation_owner();

create or replace function app_identity.reserve_administrator_usernames()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into app_identity.global_username_reservation(username,user_id,reserved_at)
    select username,user_id,reserved_at from app_identity.username_reservation
    where user_id=new.user_id order by username on conflict(username) do nothing;
  update app_identity.app_user set account_scope='installation',organization_id=null where id=new.user_id;
  return new;
end;
$$;
update app_identity.app_user set account_scope='installation',organization_id=null
  where id in (select user_id from app_identity.installation_owner union select user_id from app_identity.installation_superadmin);
alter table app_identity.app_user add constraint account_scope_membership_check
  check ((account_scope='installation' and organization_id is null) or (account_scope='agency' and organization_id is not null));

create or replace function app_identity.validate_organization_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='UPDATE' and new.parent_organization_id is distinct from old.parent_organization_id then
    raise exception 'An existing agency cannot be moved between agency groups';
  end if;
  if tg_op='INSERT' and new.parent_organization_id is not null and not exists (
    select 1 from app_identity.organization where id=new.parent_organization_id and parent_organization_id is null and active
  ) then raise exception 'The parent must be an active root agency'; end if;
  return new;
end;
$$;

alter table app_identity.app_session alter column organization_id drop not null;
create or replace function app_identity.default_session_organization()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id from app_identity.app_user where id=new.user_id;
  end if;
  if new.organization_id is null then
    if not app_identity.is_installation_superadmin(new.user_id) then
      raise exception 'Only installation administrators can open an installation session';
    end if;
  elsif not app_identity.user_can_access_organization(new.user_id,new.organization_id) then
    raise exception 'Session organization is not accessible to this account';
  end if;
  return new;
end;
$$;
-- Serialize ownership transfers across the installation, not per nomination agency.
with cancelled as (
  update app_identity.ownership_transfer set status='cancelled',resolved_at=now(),
    resolution_reason='installation_identity_upgrade' where status='pending'
  returning organization_id,id
)
insert into app_identity.ownership_transfer_event(organization_id,transfer_id,action,result,details)
  select organization_id,id,'owner.transfer.cancel','succeeded',
    '{"reason":"installation_identity_upgrade"}'::jsonb from cancelled;
create unique index ownership_transfer_installation_pending_idx
  on app_identity.ownership_transfer ((true)) where status='pending';
-- Owner recovery may fail before an account exists; its operator audit still matters.
alter table app_identity.operator_identity_event drop constraint operator_identity_event_check;
