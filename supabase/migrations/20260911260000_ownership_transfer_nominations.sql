-- Session administration's action-list replacement must retain the protected
-- role reauthentication action used by ownership initiation and acceptance.
alter table app_identity.authentication_event
  drop constraint authentication_event_action_check,
  add constraint authentication_event_action_check check (action in (
    'account.provision', 'account.reset_password', 'account.identity_change',
    'account.disable', 'account.reactivate', 'account.roles_change',
    'authentication.sign_in', 'authentication.password_change',
    'authentication.reauthenticate', 'authentication.sign_out',
    'authentication.session_revoke'
  ));

create table app_identity.ownership_transfer (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  nominated_by uuid not null,
  nominee_user_id uuid not null,
  status text not null default 'pending' check (status in (
    'pending', 'accepted', 'cancelled', 'expired', 'ineligible'
  )),
  initiated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_reason text,
  note text,
  unique (organization_id, id),
  foreign key (organization_id, nominated_by)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, nominee_user_id)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, resolved_by)
    references app_identity.app_user(organization_id, id),
  check (nominated_by <> nominee_user_id),
  check (expires_at = initiated_at + interval '72 hours'),
  check ((status = 'pending') = (resolved_at is null)),
  check (resolved_at is null or resolved_at >= initiated_at)
);

create unique index ownership_transfer_one_pending_idx
  on app_identity.ownership_transfer (organization_id) where status = 'pending';
create index ownership_transfer_nominee_pending_idx
  on app_identity.ownership_transfer (organization_id, nominee_user_id) where status = 'pending';

create table app_identity.ownership_transfer_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  transfer_id uuid,
  actor_id uuid,
  action text not null check (action in (
    'owner.transfer.initiate', 'owner.transfer.accept', 'owner.transfer.cancel',
    'owner.transfer.expire', 'owner.transfer.ineligible',
    'owner.transfer.stale_assurance', 'owner.transfer.conflict'
  )),
  result text not null check (result in ('succeeded', 'failed')),
  occurred_at timestamptz not null default now(),
  note text,
  details jsonb not null default '{}'::jsonb,
  foreign key (organization_id, transfer_id)
    references app_identity.ownership_transfer(organization_id, id),
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id),
  check (details::text !~* '"(password|password_verifier|token|csrf|secret|recovery_value)"[[:space:]]*:')
);

create index ownership_transfer_event_organization_time_idx
  on app_identity.ownership_transfer_event (organization_id, occurred_at desc, id desc);
create index ownership_transfer_event_transfer_idx
  on app_identity.ownership_transfer_event (transfer_id, occurred_at, id);

create trigger ownership_transfer_event_append_only
before update or delete on app_identity.ownership_transfer_event
for each row execute function public.prevent_update_or_delete();

create function app_identity.invalidate_ownership_transfer_for_user()
returns trigger language plpgsql as $$
declare
  invalidated app_identity.ownership_transfer%rowtype;
begin
  if old.active and not new.active then
    update app_identity.ownership_transfer transfer
       set status = 'ineligible', resolved_at = now(),
           resolution_reason = case when transfer.nominee_user_id = new.id
             then 'nominee_disabled' else 'owner_disabled' end
     where transfer.organization_id = new.organization_id
       and transfer.status = 'pending'
       and (transfer.nominated_by = new.id or transfer.nominee_user_id = new.id)
     returning transfer.* into invalidated;
    if found then
      insert into app_identity.ownership_transfer_event
        (organization_id, transfer_id, action, result, details)
      values (invalidated.organization_id, invalidated.id, 'owner.transfer.ineligible', 'succeeded',
        jsonb_build_object('reason', invalidated.resolution_reason,
          'nomineeUserId', invalidated.nominee_user_id));
    end if;
  end if;
  return new;
end;
$$;

create trigger ownership_transfer_user_eligibility
before update of active on app_identity.app_user
for each row execute function app_identity.invalidate_ownership_transfer_for_user();

create function app_identity.invalidate_ownership_transfer_for_admin_role()
returns trigger language plpgsql as $$
declare
  invalidated app_identity.ownership_transfer%rowtype;
begin
  if (tg_op = 'DELETE' or (old.ended_at is null and new.ended_at is not null)) and exists (
    select 1 from app_identity.role role
    where role.organization_id = old.organization_id and role.id = old.role_id
      and role.system_key = 'administrator'
  ) then
    update app_identity.ownership_transfer transfer
       set status = 'ineligible', resolved_at = now(), resolution_reason = 'nominee_lost_administrator'
     where transfer.organization_id = old.organization_id and transfer.status = 'pending'
       and transfer.nominee_user_id = old.user_id
     returning transfer.* into invalidated;
    if found then
      insert into app_identity.ownership_transfer_event
        (organization_id, transfer_id, action, result, details)
      values (invalidated.organization_id, invalidated.id, 'owner.transfer.ineligible', 'succeeded',
        jsonb_build_object('reason', invalidated.resolution_reason,
          'nomineeUserId', invalidated.nominee_user_id));
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger ownership_transfer_administrator_eligibility
before update of ended_at or delete on app_identity.user_role_assignment
for each row execute function app_identity.invalidate_ownership_transfer_for_admin_role();

-- Eligibility-changing writes must synchronize with acceptance even when a
-- caller bypasses the API services. Rechecking after this lock prevents a
-- concurrent disablement or Administrator removal from escaping protection
-- based on a snapshot taken before the ownership move committed.
create or replace function app_identity.protect_active_owner_user()
returns trigger language plpgsql as $$
begin
  perform 1 from app_identity.installation_owner owner_record
    where owner_record.organization_id = old.organization_id for update;
  if exists (
    select 1 from app_identity.installation_owner owner_record
    where owner_record.organization_id = old.organization_id and owner_record.user_id = old.id
  ) and (tg_op = 'DELETE' or not new.active or new.organization_id <> old.organization_id) then
    raise exception 'installation owner cannot be disabled, moved, or deleted';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_identity.protect_owner_administrator_assignment()
returns trigger language plpgsql as $$
declare
  protected_assignment boolean;
begin
  perform 1 from app_identity.installation_owner owner_record
    where owner_record.organization_id = old.organization_id for update;
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

revoke all on app_identity.ownership_transfer, app_identity.ownership_transfer_event from public;
revoke execute on function app_identity.invalidate_ownership_transfer_for_user(),
  app_identity.invalidate_ownership_transfer_for_admin_role() from public;
