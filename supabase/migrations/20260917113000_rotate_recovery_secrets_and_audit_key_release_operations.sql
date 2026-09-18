-- Wrapping secrets never enter PostgreSQL. This schema stores only version metadata,
-- wrapped report keys, and bounded audit facts.
create table offline_recovery.wrapping_key_version (
  version integer primary key check (version > 0),
  state text not null check (state in ('active', 'retiring', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  check ((state = 'retired') = (retired_at is not null))
);

insert into offline_recovery.wrapping_key_version (version, state) values (1, 'active');
insert into offline_recovery.wrapping_key_version (version, state)
select distinct wrapping_key_version, 'active'
from offline_recovery.report_key_envelope
on conflict (version) do nothing;

alter table offline_recovery.report_key_envelope
  add constraint report_key_envelope_wrapping_version_fk
  foreign key (wrapping_key_version)
  references offline_recovery.wrapping_key_version(version);

alter table offline_recovery.report_key_envelope
  drop constraint report_key_envelope_state_check,
  add constraint report_key_envelope_state_check
    check (state in ('live', 'locked', 'expired', 'purged'));

create table offline_recovery.key_lifecycle_event (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in (
    'grant_request', 'grant_issuance', 'grant_denial', 'grant_consumption',
    'envelope_registration', 'recovery', 'authorization_lock', 'expiry',
    'rotation', 'server_purge', 'account_purge', 'administrative_recovery_purge'
  )),
  actor_kind text not null check (actor_kind in ('clinician', 'system', 'administrator', 'operator')),
  actor_user_id uuid,
  organization_id uuid not null,
  report_id uuid,
  policy_version text not null check (policy_version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  outcome text not null check (outcome in ('requested', 'issued', 'denied', 'consumed', 'succeeded', 'expired', 'purged', 'locked')),
  reason_code text not null check (reason_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  occurred_at timestamptz not null default now(),
  wrapping_key_version integer,
  check ((actor_kind in ('clinician', 'administrator')) = (actor_user_id is not null))
);

comment on table offline_recovery.key_lifecycle_event is
  'Append-only bounded key-custody facts. Ciphertext, keys, clinical fields, queued/browser content, credentials, tokens, and network identifiers are structurally absent.';

create index key_lifecycle_event_organization_time_idx
  on offline_recovery.key_lifecycle_event (organization_id, occurred_at desc, id desc);
create index key_lifecycle_event_report_time_idx
  on offline_recovery.key_lifecycle_event (report_id, occurred_at desc, id desc)
  where report_id is not null;

create trigger key_lifecycle_event_append_only
before update or delete on offline_recovery.key_lifecycle_event
for each row execute function public.prevent_update_or_delete();

revoke all on offline_recovery.wrapping_key_version,
  offline_recovery.key_lifecycle_event from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_offline_key_rotator') then
    create role open_triage_offline_key_rotator nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'open_triage_offline_recovery_purger') then
    create role open_triage_offline_recovery_purger nologin;
  end if;
end;
$$;

create function offline_recovery.record_key_release_event(
  candidate_event_type text,
  candidate_actor_kind text,
  candidate_actor_user_id uuid,
  candidate_organization_id uuid,
  candidate_report_id uuid,
  candidate_policy_version text,
  candidate_outcome text,
  candidate_reason_code text,
  candidate_wrapping_key_version integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (candidate_event_type, candidate_outcome) not in (
    ('grant_request', 'requested'), ('grant_issuance', 'issued'),
    ('grant_denial', 'denied'), ('grant_consumption', 'consumed')
  ) or candidate_actor_kind not in ('clinician', 'system') then
    raise exception 'invalid key-release audit transition' using errcode = '22023';
  end if;
  insert into offline_recovery.key_lifecycle_event
    (event_type, actor_kind, actor_user_id, organization_id, report_id,
     policy_version, outcome, reason_code, wrapping_key_version)
  values
    (candidate_event_type, candidate_actor_kind, candidate_actor_user_id,
     candidate_organization_id, candidate_report_id, candidate_policy_version,
     candidate_outcome, candidate_reason_code, candidate_wrapping_key_version);
end;
$$;

create or replace function offline_recovery.register_report_key(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_wrapping_key_version integer,
  candidate_wrapping_nonce bytea,
  candidate_wrapped_data_key bytea
)
returns table (
  recovery_handle uuid,
  recovery_deadline timestamptz,
  wrapping_key_version integer,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_window integer;
  inserted_row offline_recovery.report_key_envelope%rowtype;
begin
  if not exists (
    select 1 from clinical.report report
    join app_identity.app_user owner
      on owner.id = report.documenting_user_id
     and owner.organization_id = report.organization_id
     and owner.active
    where report.id = candidate_report_id
      and report.organization_id = candidate_organization_id
      and report.documenting_user_id = candidate_owner_user_id
      and report.status = 'draft'
  ) then
    return;
  end if;

  if not exists (
    select 1 from offline_recovery.wrapping_key_version
    where version = candidate_wrapping_key_version and state = 'active'
  ) then
    raise exception 'wrapping key version is not active' using errcode = '22023';
  end if;

  select organization.offline_recovery_window_hours into selected_window
  from app_identity.organization organization
  where organization.id = candidate_organization_id;

  insert into offline_recovery.report_key_envelope
    (report_id, organization_id, owner_user_id, recovery_handle,
     wrapping_key_version, wrapping_nonce, wrapped_data_key, recovery_deadline)
  values
    (candidate_report_id, candidate_organization_id, candidate_owner_user_id,
     candidate_recovery_handle, candidate_wrapping_key_version,
     candidate_wrapping_nonce, candidate_wrapped_data_key,
     now() + make_interval(hours => selected_window))
  on conflict (report_id) do nothing
  returning * into inserted_row;

  if inserted_row.report_id is not null then
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, actor_user_id, organization_id, report_id,
       policy_version, outcome, reason_code, wrapping_key_version)
    values ('envelope_registration', 'clinician', candidate_owner_user_id,
      candidate_organization_id, candidate_report_id, 'offline-recovery-v1',
      'succeeded', 'initial_registration', candidate_wrapping_key_version);
    return query select inserted_row.recovery_handle, inserted_row.recovery_deadline,
      inserted_row.wrapping_key_version, true;
  else
    return query select existing.recovery_handle, existing.recovery_deadline,
      existing.wrapping_key_version, false
    from offline_recovery.report_key_envelope existing
    where existing.report_id = candidate_report_id;
  end if;
end;
$$;

create function offline_recovery.recover_report_key(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid
)
returns table (
  wrapping_key_version integer,
  wrapping_nonce bytea,
  wrapped_data_key bytea
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update offline_recovery.report_key_envelope envelope
  set updated_at = now()
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state = 'live'
    and envelope.recovery_deadline > now()
    and exists (
      select 1 from app_identity.app_user owner
      where owner.id = candidate_owner_user_id
        and owner.organization_id = candidate_organization_id
        and owner.active
    )
  returning envelope.wrapping_key_version, envelope.wrapping_nonce,
    envelope.wrapped_data_key;

  if found then
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, actor_user_id, organization_id, report_id,
       policy_version, outcome, reason_code)
    values ('recovery', 'clinician', candidate_owner_user_id,
      candidate_organization_id, candidate_report_id, 'offline-recovery-v1',
      'succeeded', 'owner_reauthenticated');
  end if;
end;
$$;

create function offline_recovery.lock_report_recovery(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare changed boolean;
begin
  update offline_recovery.report_key_envelope
  set state = 'locked', updated_at = now()
  where report_id = candidate_report_id and organization_id = candidate_organization_id
    and state = 'live';
  changed := found;
  if changed then
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, organization_id, report_id, policy_version, outcome, reason_code)
    values ('authorization_lock', 'system', candidate_organization_id,
      candidate_report_id, 'offline-recovery-v1', 'locked', candidate_reason_code);
  end if;
  return changed;
end;
$$;

create function offline_recovery.expire_report_recovery(candidate_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if candidate_limit not between 1 and 5000 then
    raise exception 'expiry batch limit must be between 1 and 5000' using errcode = '22023';
  end if;
  with expired as (
    update offline_recovery.report_key_envelope envelope
    set state = 'expired', wrapped_data_key = decode(repeat('00', 48), 'hex'),
      wrapping_nonce = decode(repeat('00', 12), 'hex'), updated_at = now()
    where envelope.report_id in (
      select report_id from offline_recovery.report_key_envelope
      where state in ('live', 'locked') and recovery_deadline <= now()
      order by recovery_deadline for update skip locked limit candidate_limit
    )
    returning organization_id, report_id, wrapping_key_version
  ), audited as (
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, organization_id, report_id, policy_version,
       outcome, reason_code, wrapping_key_version)
    select 'expiry', 'system', organization_id, report_id,
      'offline-recovery-v1', 'expired', 'recovery_deadline_elapsed', wrapping_key_version
    from expired returning 1
  )
  select count(*) into changed from audited;
  return changed;
end;
$$;

create function offline_recovery.register_wrapping_key_version(candidate_version integer)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into offline_recovery.wrapping_key_version(version, state)
  values (candidate_version, 'active')
  on conflict (version) do update set state =
    case when offline_recovery.wrapping_key_version.state = 'retired'
      then offline_recovery.wrapping_key_version.state else 'active' end;
$$;

create function offline_recovery.rotation_candidates(candidate_old_version integer)
returns table (
  report_id uuid, organization_id uuid, owner_user_id uuid, recovery_handle uuid,
  wrapping_nonce bytea, wrapped_data_key bytea
)
language sql
security definer
set search_path = ''
as $$
  select envelope.report_id, envelope.organization_id, envelope.owner_user_id,
    envelope.recovery_handle, envelope.wrapping_nonce, envelope.wrapped_data_key
  from offline_recovery.report_key_envelope envelope
  where envelope.state in ('live', 'locked')
    and envelope.wrapping_key_version = candidate_old_version
  order by envelope.report_id;
$$;

create function offline_recovery.rotate_report_key(
  candidate_report_id uuid,
  candidate_old_version integer,
  candidate_new_version integer,
  candidate_wrapping_nonce bytea,
  candidate_wrapped_data_key bytea
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare rotated offline_recovery.report_key_envelope%rowtype;
begin
  if candidate_new_version <= candidate_old_version or not exists (
    select 1 from offline_recovery.wrapping_key_version
    where version = candidate_new_version and state = 'active'
  ) then
    raise exception 'new wrapping key version must be newer and active' using errcode = '22023';
  end if;
  update offline_recovery.report_key_envelope
  set wrapping_key_version = candidate_new_version,
    wrapping_nonce = candidate_wrapping_nonce,
    wrapped_data_key = candidate_wrapped_data_key,
    updated_at = now()
  where report_id = candidate_report_id and state in ('live', 'locked')
    and wrapping_key_version = candidate_old_version
  returning * into rotated;
  if rotated.report_id is null then return false; end if;
  insert into offline_recovery.key_lifecycle_event
    (event_type, actor_kind, organization_id, report_id, policy_version,
     outcome, reason_code, wrapping_key_version)
  values ('rotation', 'operator', rotated.organization_id, rotated.report_id,
    'offline-recovery-v1', 'succeeded', 'wrapping_key_rewrapped', candidate_new_version);
  return true;
end;
$$;

create function offline_recovery.rotation_coverage(candidate_old_version integer, candidate_new_version integer)
returns table (old_live_count bigint, new_live_count bigint, other_live_count bigint)
language sql
security definer
set search_path = ''
as $$
  select
    count(*) filter (where wrapping_key_version = candidate_old_version),
    count(*) filter (where wrapping_key_version = candidate_new_version),
    count(*) filter (where wrapping_key_version not in (candidate_old_version, candidate_new_version))
  from offline_recovery.report_key_envelope where state in ('live', 'locked');
$$;

create function offline_recovery.retire_wrapping_key_version(candidate_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from offline_recovery.report_key_envelope
    where state in ('live', 'locked') and wrapping_key_version = candidate_version
  ) then
    raise exception 'cannot retire a wrapping key version referenced by a live envelope'
      using errcode = '55000';
  end if;
  update offline_recovery.wrapping_key_version
  set state = 'retired', retired_at = now()
  where version = candidate_version and state <> 'retired';
  if not found then raise exception 'wrapping key version is unavailable'; end if;
end;
$$;

create function offline_recovery.purge_recovery_data(
  candidate_organization_id uuid,
  candidate_report_id uuid,
  candidate_actor_user_id uuid,
  candidate_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare purged offline_recovery.report_key_envelope%rowtype;
begin
  delete from offline_recovery.report_key_envelope
  where organization_id = candidate_organization_id and report_id = candidate_report_id
  returning * into purged;
  if purged.report_id is null then return false; end if;
  insert into offline_recovery.key_lifecycle_event
    (event_type, actor_kind, actor_user_id, organization_id, report_id,
     policy_version, outcome, reason_code, wrapping_key_version)
  values ('administrative_recovery_purge', 'administrator', candidate_actor_user_id,
    candidate_organization_id, candidate_report_id, 'offline-recovery-v1',
    'purged', candidate_reason_code, purged.wrapping_key_version);
  return true;
end;
$$;

create function offline_recovery.purge_server_recovery(
  candidate_report_id uuid, candidate_organization_id uuid, candidate_reason_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare purged offline_recovery.report_key_envelope%rowtype;
begin
  delete from offline_recovery.report_key_envelope
  where report_id = candidate_report_id and organization_id = candidate_organization_id
  returning * into purged;
  if purged.report_id is null then return false; end if;
  insert into offline_recovery.key_lifecycle_event
    (event_type, actor_kind, organization_id, report_id, policy_version,
     outcome, reason_code, wrapping_key_version)
  values ('server_purge', 'system', candidate_organization_id, candidate_report_id,
    'offline-recovery-v1', 'purged', candidate_reason_code, purged.wrapping_key_version);
  return true;
end;
$$;

create function offline_recovery.purge_account_recovery(
  candidate_organization_id uuid, candidate_owner_user_id uuid, candidate_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  with purged as (
    delete from offline_recovery.report_key_envelope
    where organization_id = candidate_organization_id and owner_user_id = candidate_owner_user_id
    returning organization_id, report_id, wrapping_key_version
  ), audited as (
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, organization_id, report_id, policy_version,
       outcome, reason_code, wrapping_key_version)
    select 'account_purge', 'system', organization_id, report_id,
      'offline-recovery-v1', 'purged', candidate_reason_code, wrapping_key_version
    from purged returning 1
  ) select count(*) into changed from audited;
  return changed;
end;
$$;

revoke all on all functions in schema offline_recovery from public;

-- Supabase provisions these API roles, while the supported standalone
-- PostgreSQL deployment does not. Revoke them when present without making the
-- migration depend on Supabase-specific cluster roles.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all on all functions in schema offline_recovery from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;
grant usage on schema offline_recovery to open_triage_offline_runtime,
  open_triage_offline_key_rotator, open_triage_offline_recovery_purger;

grant execute on function offline_recovery.register_report_key(uuid, uuid, uuid, uuid, integer, bytea, bytea),
  offline_recovery.record_key_release_event(text, text, uuid, uuid, uuid, text, text, text, integer),
  offline_recovery.recover_report_key(uuid, uuid, uuid, uuid),
  offline_recovery.lock_report_recovery(uuid, uuid, text),
  offline_recovery.expire_report_recovery(integer),
  offline_recovery.purge_server_recovery(uuid, uuid, text),
  offline_recovery.purge_account_recovery(uuid, uuid, text)
to open_triage_offline_runtime;

grant execute on function offline_recovery.register_wrapping_key_version(integer),
  offline_recovery.rotation_candidates(integer),
  offline_recovery.rotate_report_key(uuid, integer, integer, bytea, bytea),
  offline_recovery.rotation_coverage(integer, integer),
  offline_recovery.retire_wrapping_key_version(integer)
to open_triage_offline_key_rotator;

grant execute on function offline_recovery.purge_recovery_data(uuid, uuid, uuid, text)
to open_triage_offline_recovery_purger;

-- No lifecycle role receives table DML, schema creation, role membership, or a
-- function that returns another clinician's plaintext report key.
