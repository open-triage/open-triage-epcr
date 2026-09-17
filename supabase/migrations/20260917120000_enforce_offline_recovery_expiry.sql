-- Recovery retention is enforced where the recoverable key lives. Browser
-- ciphertext may outlive this row temporarily, but it is useless after the
-- wrapped key has been destroyed.
update offline_recovery.report_key_envelope
set wrapping_nonce = null, wrapped_data_key = null
where state in ('expired', 'purged');

alter table offline_recovery.report_key_envelope
  alter column wrapping_nonce drop not null,
  alter column wrapped_data_key drop not null,
  drop constraint report_key_envelope_wrapping_nonce_check,
  drop constraint report_key_envelope_wrapped_data_key_check,
  add constraint report_key_envelope_wrapping_nonce_check check (
    (state in ('live', 'locked') and octet_length(wrapping_nonce) = 12)
    or (state in ('expired', 'purged') and (
      wrapping_nonce is null or wrapping_nonce = decode(repeat('00', 12), 'hex')
    ))
  ),
  add constraint report_key_envelope_wrapped_data_key_check check (
    (state in ('live', 'locked') and octet_length(wrapped_data_key) = 48)
    or (state in ('expired', 'purged') and (
      wrapped_data_key is null or wrapped_data_key = decode(repeat('00', 48), 'hex')
    ))
  );

create table offline_recovery.event (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  report_id uuid not null,
  recovery_handle uuid not null,
  event_type text not null check (event_type in (
    'ciphertext_written', 'recovery_succeeded', 'recovery_unavailable',
    'key_expired', 'policy_shortened'
  )),
  ciphertext_revision bigint,
  occurred_at timestamptz not null default clock_timestamp()
);

create index offline_recovery_event_report_idx
  on offline_recovery.event (organization_id, report_id, occurred_at desc);

revoke all on offline_recovery.event from public;

create function offline_recovery.expire_due_report_keys(
  candidate_now timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, offline_recovery
as $$
declare
  expired_count integer;
begin
  with expired as (
    update offline_recovery.report_key_envelope envelope
    set state = 'expired', wrapping_nonce = null, wrapped_data_key = null,
        ciphertext_sha256 = null, updated_at = candidate_now
    where envelope.state in ('live', 'locked') and envelope.recovery_deadline <= candidate_now
    returning envelope.organization_id, envelope.report_id,
      envelope.recovery_handle, envelope.ciphertext_revision
  ), audited as (
    insert into offline_recovery.event
      (organization_id, report_id, recovery_handle, event_type,
       ciphertext_revision, occurred_at)
    select organization_id, report_id, recovery_handle, 'key_expired',
      ciphertext_revision, candidate_now
    from expired
  )
  select count(*) into expired_count from expired;
  return expired_count;
end;
$$;

create function offline_recovery.record_ciphertext_write(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_ciphertext_revision bigint,
  candidate_ciphertext_sha256 text,
  candidate_written_at timestamptz
)
returns table (recovery_deadline timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, offline_recovery, clinical, app_identity
as $$
declare
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_window integer;
  selected_report_expiry timestamptz;
  selected_deadline timestamptz;
begin
  perform offline_recovery.expire_due_report_keys(candidate_written_at);

  select envelope.* into selected_envelope
  from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
  for update;

  if not found or selected_envelope.state <> 'live'
     or selected_envelope.organization_id <> candidate_organization_id
     or selected_envelope.owner_user_id <> candidate_owner_user_id
     or selected_envelope.recovery_handle <> candidate_recovery_handle
     or candidate_ciphertext_revision <= selected_envelope.ciphertext_revision
     or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  select organization.offline_recovery_window_hours, report.expires_at
    into selected_window, selected_report_expiry
  from clinical.report report
  join app_identity.organization organization
    on organization.id = report.organization_id
  where report.id = candidate_report_id
    and report.organization_id = candidate_organization_id
    and report.documenting_user_id = candidate_owner_user_id
    and report.status = 'draft';

  if not found then return; end if;
  selected_deadline := candidate_written_at + make_interval(hours => selected_window);
  if selected_report_expiry is not null then
    selected_deadline := least(selected_deadline, selected_report_expiry);
  end if;
  if selected_deadline <= candidate_written_at then
    perform offline_recovery.expire_due_report_keys(candidate_written_at);
    return;
  end if;

  update offline_recovery.report_key_envelope envelope
  set ciphertext_revision = candidate_ciphertext_revision,
      ciphertext_sha256 = candidate_ciphertext_sha256,
      recovery_deadline = selected_deadline,
      updated_at = candidate_written_at
  where envelope.report_id = candidate_report_id;

  insert into offline_recovery.event
    (organization_id, report_id, recovery_handle, event_type,
     ciphertext_revision, occurred_at)
  values (candidate_organization_id, candidate_report_id,
    candidate_recovery_handle, 'ciphertext_written',
    candidate_ciphertext_revision, candidate_written_at);

  return query select selected_deadline;
end;
$$;

create or replace function offline_recovery.recover_report_key(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_now timestamptz
)
returns table (
  wrapping_key_version integer,
  wrapping_nonce bytea,
  wrapped_data_key bytea
)
language plpgsql
security definer
set search_path = pg_catalog, offline_recovery, clinical
as $$
declare
  selected offline_recovery.report_key_envelope%rowtype;
begin
  perform offline_recovery.expire_due_report_keys(candidate_now);
  select envelope.* into selected
  from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
  for update;

  if not found or selected.organization_id <> candidate_organization_id
     or selected.owner_user_id <> candidate_owner_user_id
     or selected.recovery_handle <> candidate_recovery_handle
     or selected.state <> 'live' or selected.recovery_deadline <= candidate_now
     or selected.wrapped_data_key is null or selected.wrapping_nonce is null then
    insert into offline_recovery.event
      (organization_id, report_id, recovery_handle, event_type, occurred_at)
    values (candidate_organization_id, candidate_report_id,
      candidate_recovery_handle, 'recovery_unavailable', candidate_now);
    return;
  end if;

  insert into offline_recovery.event
    (organization_id, report_id, recovery_handle, event_type,
     ciphertext_revision, occurred_at)
  values (candidate_organization_id, candidate_report_id,
    candidate_recovery_handle, 'recovery_succeeded',
    selected.ciphertext_revision, candidate_now);

  return query select selected.wrapping_key_version,
    selected.wrapping_nonce, selected.wrapped_data_key;
end;
$$;

create function offline_recovery.apply_shorter_organization_policy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, offline_recovery, clinical
as $$
declare
  changed_at timestamptz := clock_timestamp();
begin
  if new.offline_recovery_window_hours >= old.offline_recovery_window_hours then
    return new;
  end if;

  with shortened as (
    update offline_recovery.report_key_envelope envelope
    set recovery_deadline = least(
          envelope.recovery_deadline,
          changed_at + make_interval(hours => new.offline_recovery_window_hours),
          coalesce(report.expires_at, 'infinity'::timestamptz)
        ),
        updated_at = changed_at
    from clinical.report report
    where envelope.organization_id = new.id
      and envelope.report_id = report.id
      and envelope.state in ('live', 'locked')
    returning envelope.organization_id, envelope.report_id,
      envelope.recovery_handle, envelope.ciphertext_revision
  )
  insert into offline_recovery.event
    (organization_id, report_id, recovery_handle, event_type,
     ciphertext_revision, occurred_at)
  select organization_id, report_id, recovery_handle, 'policy_shortened',
    ciphertext_revision, changed_at
  from shortened;

  perform offline_recovery.expire_due_report_keys(changed_at);
  return new;
end;
$$;

create trigger organization_shorter_offline_recovery_policy
after update of offline_recovery_window_hours on app_identity.organization
for each row execute function offline_recovery.apply_shorter_organization_policy();

-- Replacing registration prevents an expired tombstone from being revived.
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
set search_path = pg_catalog, offline_recovery, clinical, app_identity
as $$
declare
  selected_window integer;
  selected_report_expiry timestamptz;
  selected_deadline timestamptz;
begin
  perform offline_recovery.expire_due_report_keys(clock_timestamp());
  if exists (
    select 1 from offline_recovery.report_key_envelope
    where report_id = candidate_report_id and state <> 'live'
  ) then return; end if;

  if not exists (
    select 1 from offline_recovery.wrapping_key_version
    where version = candidate_wrapping_key_version and state = 'active'
  ) then
    raise exception 'wrapping key version is not active' using errcode = '22023';
  end if;

  select organization.offline_recovery_window_hours, report.expires_at
    into selected_window, selected_report_expiry
  from clinical.report report
  join app_identity.app_user owner
    on owner.id = report.documenting_user_id
   and owner.organization_id = report.organization_id and owner.active
  join app_identity.organization organization
    on organization.id = report.organization_id
  where report.id = candidate_report_id
    and report.organization_id = candidate_organization_id
    and report.documenting_user_id = candidate_owner_user_id
    and report.status = 'draft';
  if not found then return; end if;

  selected_deadline := clock_timestamp() + make_interval(hours => selected_window);
  if selected_report_expiry is not null then
    selected_deadline := least(selected_deadline, selected_report_expiry);
  end if;
  if selected_deadline <= clock_timestamp() then return; end if;

  return query
  with inserted as (
    insert into offline_recovery.report_key_envelope
      (report_id, organization_id, owner_user_id, recovery_handle,
       wrapping_key_version, wrapping_nonce, wrapped_data_key, recovery_deadline)
    values (candidate_report_id, candidate_organization_id,
      candidate_owner_user_id, candidate_recovery_handle,
      candidate_wrapping_key_version, candidate_wrapping_nonce,
      candidate_wrapped_data_key, selected_deadline)
    on conflict (report_id) do nothing
    returning report_key_envelope.recovery_handle,
      report_key_envelope.recovery_deadline,
      report_key_envelope.wrapping_key_version
  ), audited as (
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, actor_user_id, organization_id, report_id,
       policy_version, outcome, reason_code, wrapping_key_version)
    select 'envelope_registration', 'clinician', candidate_owner_user_id,
      candidate_organization_id, candidate_report_id, 'offline-recovery-v1',
      'succeeded', 'initial_registration', inserted.wrapping_key_version
    from inserted
    returning 1
  )
  select inserted.recovery_handle, inserted.recovery_deadline,
    inserted.wrapping_key_version, true from inserted
  union all
  select existing.recovery_handle, existing.recovery_deadline,
    existing.wrapping_key_version, false
  from offline_recovery.report_key_envelope existing
  where existing.report_id = candidate_report_id and existing.state = 'live'
    and existing.recovery_deadline > clock_timestamp()
    and not exists (select 1 from inserted);
end;
$$;

-- Runtime wrappers deliberately do not accept clocks supplied by callers.
create function offline_recovery.expire_due_report_keys()
returns integer
language sql
security definer
set search_path = pg_catalog, offline_recovery
as $$
  select offline_recovery.expire_due_report_keys(clock_timestamp());
$$;

create function offline_recovery.record_ciphertext_write(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_ciphertext_revision bigint,
  candidate_ciphertext_sha256 text
)
returns table (recovery_deadline timestamptz)
language sql
security definer
set search_path = pg_catalog, offline_recovery
as $$
  select * from offline_recovery.record_ciphertext_write(
    candidate_report_id, candidate_organization_id, candidate_owner_user_id,
    candidate_recovery_handle, candidate_ciphertext_revision,
    candidate_ciphertext_sha256, clock_timestamp()
  );
$$;

create or replace function offline_recovery.recover_report_key(
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
declare recovered record;
begin
  select * into recovered from offline_recovery.recover_report_key(
    candidate_report_id, candidate_organization_id,
    candidate_owner_user_id, candidate_recovery_handle, clock_timestamp()
  );
  if not found then return; end if;

  insert into offline_recovery.key_lifecycle_event
    (event_type, actor_kind, actor_user_id, organization_id, report_id,
     policy_version, outcome, reason_code, wrapping_key_version)
  values ('recovery', 'clinician', candidate_owner_user_id,
    candidate_organization_id, candidate_report_id, 'offline-recovery-v1',
    'succeeded', 'owner_reauthenticated', recovered.wrapping_key_version);

  return query select recovered.wrapping_key_version::integer,
    recovered.wrapping_nonce::bytea, recovered.wrapped_data_key::bytea;
end;
$$;

revoke all on function offline_recovery.expire_due_report_keys(timestamptz) from public;
revoke all on function offline_recovery.expire_due_report_keys() from public;
revoke all on function offline_recovery.record_ciphertext_write(uuid, uuid, uuid, uuid, bigint, text, timestamptz) from public;
revoke all on function offline_recovery.record_ciphertext_write(uuid, uuid, uuid, uuid, bigint, text) from public;
revoke all on function offline_recovery.recover_report_key(uuid, uuid, uuid, uuid, timestamptz) from public;
revoke all on function offline_recovery.recover_report_key(uuid, uuid, uuid, uuid) from public;
revoke all on function offline_recovery.apply_shorter_organization_policy() from public;

grant execute on function offline_recovery.expire_due_report_keys() to open_triage_offline_runtime;
grant execute on function offline_recovery.record_ciphertext_write(uuid, uuid, uuid, uuid, bigint, text) to open_triage_offline_runtime;
grant execute on function offline_recovery.recover_report_key(uuid, uuid, uuid, uuid) to open_triage_offline_runtime;
