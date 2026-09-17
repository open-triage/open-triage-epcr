-- Completed reports may retain a wrapped key only while authenticated late work
-- remains. A server purge is final even if a delayed client retries registration.
alter table offline_recovery.report_key_envelope
  add column synchronized_revision bigint not null default 0
    check (synchronized_revision >= 0 and synchronized_revision <= ciphertext_revision);

alter table offline_recovery.report_key_envelope
  drop constraint report_key_envelope_state_check,
  add constraint report_key_envelope_state_check
    check (state in ('live', 'completed', 'locked', 'expired', 'purged'));

alter table offline_recovery.report_key_envelope
  drop constraint report_key_envelope_wrapping_nonce_check,
  drop constraint report_key_envelope_wrapped_data_key_check,
  add constraint report_key_envelope_wrapping_nonce_check check (
    (state in ('live', 'completed', 'locked') and octet_length(wrapping_nonce) = 12)
    or (state in ('expired', 'purged') and
      (wrapping_nonce is null or wrapping_nonce = decode(repeat('00', 12), 'hex')))
  ),
  add constraint report_key_envelope_wrapped_data_key_check check (
    (state in ('live', 'completed', 'locked') and octet_length(wrapped_data_key) = 48)
    or (state in ('expired', 'purged') and
      (wrapped_data_key is null or wrapped_data_key = decode(repeat('00', 48), 'hex')))
  );

create table offline_recovery.report_purge_tombstone (
  report_id uuid primary key,
  organization_id uuid not null,
  reason_code text not null check (reason_code ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  purged_at timestamptz not null default clock_timestamp()
);

comment on table offline_recovery.report_purge_tombstone is
  'Non-clinical cryptographic-erasure fact preventing recreation or delayed key release.';
revoke all on offline_recovery.report_purge_tombstone from public, anon, authenticated;

create or replace function offline_recovery.checkpoint_report_ciphertext(
  candidate_report_id uuid, candidate_organization_id uuid,
  candidate_owner_user_id uuid, candidate_recovery_handle uuid,
  candidate_ciphertext_revision bigint, candidate_ciphertext_sha256 text
)
returns table (ciphertext_revision bigint, ciphertext_sha256 text)
language plpgsql security definer set search_path = '' as $$
declare current_envelope offline_recovery.report_key_envelope%rowtype;
begin
  if candidate_ciphertext_revision < 1 or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid protected ciphertext checkpoint' using errcode = '22023';
  end if;
  if exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then return; end if;
  select * into current_envelope from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state = 'live' and envelope.recovery_deadline > now()
  for update;
  if not found then return; end if;
  if candidate_ciphertext_revision < current_envelope.synchronized_revision then
    raise exception 'protected ciphertext rollback rejected' using errcode = '40001';
  end if;
  if candidate_ciphertext_revision = current_envelope.ciphertext_revision
     and current_envelope.ciphertext_sha256 is distinct from candidate_ciphertext_sha256 then
    raise exception 'protected ciphertext revision hash mismatch' using errcode = '23505';
  end if;
  update offline_recovery.report_key_envelope
  set ciphertext_revision = greatest(ciphertext_revision, candidate_ciphertext_revision),
      synchronized_revision = candidate_ciphertext_revision,
      ciphertext_sha256 = candidate_ciphertext_sha256, updated_at = now()
  where report_id = candidate_report_id;
  return query select candidate_ciphertext_revision, candidate_ciphertext_sha256;
end;
$$;

create or replace function offline_recovery.expire_due_report_keys(candidate_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare expired_count integer;
begin
  with expired as (
    update offline_recovery.report_key_envelope envelope
    set state = 'expired', wrapping_nonce = null, wrapped_data_key = null,
        ciphertext_sha256 = null, updated_at = candidate_now
    where envelope.state in ('live', 'completed', 'locked')
      and envelope.recovery_deadline <= candidate_now
    returning envelope.organization_id, envelope.report_id,
      envelope.recovery_handle, envelope.ciphertext_revision
  ), audited as (
    insert into offline_recovery.event
      (organization_id, report_id, recovery_handle, event_type,
       ciphertext_revision, occurred_at)
    select organization_id, report_id, recovery_handle, 'key_expired',
      ciphertext_revision, candidate_now from expired
  ) select count(*) into expired_count from expired;
  return expired_count;
end;
$$;

create or replace function offline_recovery.recover_report_key(
  candidate_report_id uuid, candidate_organization_id uuid,
  candidate_owner_user_id uuid, candidate_recovery_handle uuid
)
returns table (wrapping_key_version integer, wrapping_nonce bytea, wrapped_data_key bytea)
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then return; end if;
  return query update offline_recovery.report_key_envelope envelope set updated_at = now()
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    -- The server cannot observe ciphertext written while disconnected. A
    -- completed envelope therefore remains recoverable until its deadline;
    -- the authenticated client decides whether its payload has queued work.
    and envelope.state in ('live', 'completed')
    and envelope.recovery_deadline > now()
    and envelope.wrapping_nonce is not null and envelope.wrapped_data_key is not null
    and exists (select 1 from app_identity.app_user owner
      where owner.id = candidate_owner_user_id
        and owner.organization_id = candidate_organization_id and owner.active)
  returning envelope.wrapping_key_version, envelope.wrapping_nonce, envelope.wrapped_data_key;
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

create or replace function offline_recovery.register_report_key(
  candidate_report_id uuid, candidate_organization_id uuid,
  candidate_owner_user_id uuid, candidate_recovery_handle uuid,
  candidate_wrapping_key_version integer, candidate_wrapping_nonce bytea,
  candidate_wrapped_data_key bytea
)
returns table (recovery_handle uuid, recovery_deadline timestamptz,
  wrapping_key_version integer, created boolean)
language plpgsql security definer set search_path = '' as $$
declare selected_window integer; selected_expiry timestamptz;
  selected_deadline timestamptz; inserted_row offline_recovery.report_key_envelope%rowtype;
begin
  if exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then return; end if;
  select organization.offline_recovery_window_hours, report.expires_at into selected_window, selected_expiry
  from clinical.report report
  join app_identity.app_user owner on owner.id = report.documenting_user_id
    and owner.organization_id = report.organization_id and owner.active
  join app_identity.organization organization on organization.id = report.organization_id
  where report.id = candidate_report_id and report.organization_id = candidate_organization_id
    and report.documenting_user_id = candidate_owner_user_id and report.status = 'draft';
  if not found or not exists (select 1 from offline_recovery.wrapping_key_version
    where version = candidate_wrapping_key_version and state = 'active') then return; end if;
  selected_deadline := least(clock_timestamp() + make_interval(hours => selected_window),
    coalesce(selected_expiry, 'infinity'::timestamptz));
  if selected_deadline <= clock_timestamp() then return; end if;
  insert into offline_recovery.report_key_envelope
    (report_id, organization_id, owner_user_id, recovery_handle,
     wrapping_key_version, wrapping_nonce, wrapped_data_key, recovery_deadline)
  values (candidate_report_id, candidate_organization_id, candidate_owner_user_id,
    candidate_recovery_handle, candidate_wrapping_key_version,
    candidate_wrapping_nonce, candidate_wrapped_data_key, selected_deadline)
  on conflict (report_id) do nothing returning * into inserted_row;
  if inserted_row.report_id is not null then
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, actor_user_id, organization_id, report_id,
       policy_version, outcome, reason_code, wrapping_key_version)
    values ('envelope_registration', 'clinician', candidate_owner_user_id,
      candidate_organization_id, candidate_report_id, 'offline-recovery-v1',
      'succeeded', 'initial_registration', candidate_wrapping_key_version);
    return query select inserted_row.recovery_handle, inserted_row.recovery_deadline,
      inserted_row.wrapping_key_version, true;
  end if;
  return query select envelope.recovery_handle, envelope.recovery_deadline,
    envelope.wrapping_key_version, false from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id and envelope.state = 'live';
end;
$$;

create function offline_recovery.mark_report_completed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'draft' and new.status = 'signed' then
    update offline_recovery.report_key_envelope set state = 'completed', updated_at = clock_timestamp()
    where report_id = new.id and organization_id = new.organization_id and state = 'live';
    if found then
      insert into offline_recovery.key_lifecycle_event
        (event_type, actor_kind, organization_id, report_id, policy_version, outcome, reason_code)
      values ('authorization_lock', 'system', new.organization_id, new.id,
        'offline-recovery-v1', 'locked', 'report_completed');
    end if;
  end if;
  return new;
end;
$$;
create trigger report_completion_locks_offline_recovery
after update of status on clinical.report
for each row execute function offline_recovery.mark_report_completed();

create or replace function offline_recovery.purge_server_recovery(
  candidate_report_id uuid, candidate_organization_id uuid, candidate_reason_code text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare purged offline_recovery.report_key_envelope%rowtype;
begin
  insert into offline_recovery.report_purge_tombstone (report_id, organization_id, reason_code)
  values (candidate_report_id, candidate_organization_id, candidate_reason_code)
  on conflict (report_id) do nothing;
  update offline_recovery.report_key_envelope
  set state = 'purged', wrapping_nonce = null, wrapped_data_key = null,
      ciphertext_sha256 = null, updated_at = clock_timestamp()
  where report_id = candidate_report_id and organization_id = candidate_organization_id
    and state <> 'purged' returning * into purged;
  delete from offline_recovery.report_recovery_grant where report_id = candidate_report_id;
  if purged.report_id is null then return false; end if;
  insert into offline_recovery.key_lifecycle_event
    (event_type, actor_kind, organization_id, report_id, policy_version,
     outcome, reason_code, wrapping_key_version)
  values ('server_purge', 'system', candidate_organization_id, candidate_report_id,
    'offline-recovery-v1', 'purged', candidate_reason_code, purged.wrapping_key_version);
  return true;
end;
$$;

create function offline_recovery.purge_report_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform offline_recovery.purge_server_recovery(old.id, old.organization_id, 'report_deleted');
  return old;
end;
$$;
create trigger report_delete_purges_offline_recovery
before delete on clinical.report for each row execute function offline_recovery.purge_report_before_delete();

alter table offline_recovery.report_recovery_grant
  drop constraint report_recovery_grant_eligible_report_state_check,
  add constraint report_recovery_grant_eligible_report_state_check
    check (eligible_report_state in ('draft', 'signed'));

drop function offline_recovery.create_report_recovery_grant(uuid, uuid, uuid, text, text, integer);
create function offline_recovery.create_report_recovery_grant(
  candidate_report_id uuid, candidate_organization_id uuid, candidate_user_id uuid,
  candidate_session_token_sha256 text, candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (result text, recovery_handle uuid, grant_id uuid,
  expires_at timestamptz, report_status text)
language plpgsql security definer set search_path = '' as $$
declare selected_session app_identity.app_session%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_policy boolean; selected_reason text; selected_grant_id uuid;
  selected_expires_at timestamptz; selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.expire_due_report_keys();
  select session.* into selected_session from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  join app_identity.local_credential credential on credential.user_id = app_user.id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and app_user.organization_id = candidate_organization_id and app_user.active
    and session.revoked_at is null and session.expires_at > selected_now
    and session.credential_version = credential.credential_version;
  if selected_session.id is null then selected_reason := 'unauthorized';
  elsif not app_identity.user_has_capability(candidate_user_id, candidate_organization_id, 'clinical:document') then
    selected_reason := 'unauthorized';
  elsif exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then
    selected_reason := 'purged';
  else
    select * into selected_report from clinical.report where id = candidate_report_id;
    if selected_report.id is null then selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
    else
      select * into selected_envelope from offline_recovery.report_key_envelope where report_id = candidate_report_id;
      if selected_envelope.report_id is null or selected_envelope.envelope_version <> candidate_envelope_version then
        selected_reason := 'missing';
      elsif selected_envelope.organization_id <> candidate_organization_id
        or selected_envelope.owner_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
      elsif selected_envelope.state = 'purged' then selected_reason := 'purged';
      elsif selected_envelope.state = 'expired' or selected_envelope.recovery_deadline <= selected_now then
        selected_reason := 'expired';
      elsif selected_report.status = 'draft' and selected_envelope.state <> 'live' then
        selected_reason := 'unauthorized';
      elsif selected_report.status = 'signed'
        and selected_envelope.state <> 'completed' then selected_reason := 'ineligible_state';
      elsif selected_report.status not in ('draft', 'signed')
        or selected_envelope.wrapping_nonce is null or selected_envelope.wrapped_data_key is null then
        selected_reason := 'ineligible_state';
      end if;
    end if;
  end if;
  if selected_reason is null then
    select offline_recovery_restart_reauthentication_required into selected_policy
    from app_identity.organization where id = candidate_organization_id;
    if selected_policy and greatest(selected_session.created_at,
      coalesce(selected_session.reauthenticated_at, selected_session.created_at))
      < selected_now - interval '5 minutes' then selected_reason := 'reauthentication_required'; end if;
  end if;
  if selected_reason is not null then
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, action, outcome, reason)
    values (candidate_organization_id, candidate_user_id, candidate_report_id,
      selected_session.id, 'grant', 'denied', selected_reason);
    return query select case when selected_reason = 'reauthentication_required'
      then 'reauthentication_required' else 'denied' end,
      null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;
  insert into offline_recovery.report_recovery_grant
    (token_sha256, session_id, user_id, organization_id, report_id,
     envelope_version, required_capability, owner_user_id,
     eligible_report_state, created_at, expires_at)
  values (candidate_grant_token_sha256, selected_session.id, candidate_user_id,
    candidate_organization_id, candidate_report_id, candidate_envelope_version,
    'clinical:document', candidate_user_id, selected_report.status,
    selected_now, selected_now + interval '60 seconds')
  returning id, report_recovery_grant.expires_at into selected_grant_id, selected_expires_at;
  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id, action, outcome, reason)
  values (candidate_organization_id, candidate_user_id, candidate_report_id,
    selected_session.id, selected_grant_id, 'grant', 'succeeded', 'allowed');
  return query select 'created'::text, selected_envelope.recovery_handle,
    selected_grant_id, selected_expires_at, selected_report.status;
end;
$$;

create or replace function offline_recovery.consume_report_recovery_grant(
  candidate_report_id uuid, candidate_organization_id uuid, candidate_user_id uuid,
  candidate_session_token_sha256 text, candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (result text, recovery_handle uuid, wrapping_key_version integer,
  wrapping_nonce bytea, wrapped_data_key bytea)
language plpgsql security definer set search_path = '' as $$
declare selected_session app_identity.app_session%rowtype;
  selected_grant offline_recovery.report_recovery_grant%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  released_key record; selected_policy boolean; selected_reason text;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.expire_due_report_keys();
  select session.* into selected_session from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  join app_identity.local_credential credential on credential.user_id = app_user.id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and app_user.organization_id = candidate_organization_id and app_user.active
    and session.revoked_at is null and session.expires_at > selected_now
    and session.credential_version = credential.credential_version;
  select * into selected_grant from offline_recovery.report_recovery_grant
  where token_sha256 = candidate_grant_token_sha256 for update;
  if selected_session.id is null then selected_reason := 'unauthorized';
  elsif selected_grant.id is null then selected_reason := 'missing';
  elsif selected_grant.consumed_at is not null then selected_reason := 'replayed';
  elsif selected_grant.expires_at <= selected_now then selected_reason := 'grant_expired';
  elsif selected_grant.session_id <> selected_session.id or selected_grant.user_id <> candidate_user_id
    or selected_grant.organization_id <> candidate_organization_id
    or selected_grant.report_id <> candidate_report_id
    or selected_grant.envelope_version <> candidate_envelope_version
    or selected_grant.owner_user_id <> candidate_user_id
    or selected_grant.required_capability <> 'clinical:document' then selected_reason := 'binding_mismatch';
  elsif exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then
    selected_reason := 'purged';
  else
    select offline_recovery_restart_reauthentication_required into selected_policy
    from app_identity.organization where id = candidate_organization_id;
    if selected_policy and greatest(selected_session.created_at,
      coalesce(selected_session.reauthenticated_at, selected_session.created_at))
      < selected_now - interval '5 minutes' then selected_reason := 'reauthentication_required'; end if;
  end if;
  if selected_reason is null and not app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document') then selected_reason := 'unauthorized';
  elsif selected_reason is null then
    select * into selected_report from clinical.report where id = candidate_report_id;
    select * into selected_envelope from offline_recovery.report_key_envelope where report_id = candidate_report_id;
    if selected_report.id is null or selected_envelope.report_id is null then selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
    elsif selected_report.status <> selected_grant.eligible_report_state then selected_reason := 'ineligible_state';
    elsif selected_report.status = 'draft' and selected_envelope.state <> 'live' then selected_reason := 'unauthorized';
    elsif selected_report.status = 'signed' and selected_envelope.state <> 'completed' then
      selected_reason := 'ineligible_state';
    end if;
  end if;
  if selected_reason is null then
    select * into released_key from offline_recovery.recover_report_key(
      candidate_report_id, candidate_organization_id, candidate_user_id,
      selected_envelope.recovery_handle);
    if not found then selected_reason := 'expired'; end if;
  end if;
  if selected_reason is not null then
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, grant_id, action, outcome, reason)
    values (candidate_organization_id, candidate_user_id, candidate_report_id,
      selected_session.id, selected_grant.id, 'consume', 'denied', selected_reason);
    return query select 'denied'::text, null::uuid, null::integer, null::bytea, null::bytea;
    return;
  end if;
  update offline_recovery.report_recovery_grant set consumed_at = selected_now
  where id = selected_grant.id and consumed_at is null;
  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id, action, outcome, reason)
  values (candidate_organization_id, candidate_user_id, candidate_report_id,
    selected_session.id, selected_grant.id, 'consume', 'succeeded', 'allowed');
  return query select 'consumed'::text, selected_envelope.recovery_handle,
    released_key.wrapping_key_version::integer,
    released_key.wrapping_nonce::bytea, released_key.wrapped_data_key::bytea;
end;
$$;

revoke all on function offline_recovery.mark_report_completed(),
  offline_recovery.purge_report_before_delete() from public, anon, authenticated;
revoke all on function offline_recovery.checkpoint_report_ciphertext(uuid, uuid, uuid, uuid, bigint, text),
  offline_recovery.expire_due_report_keys(timestamptz),
  offline_recovery.recover_report_key(uuid, uuid, uuid, uuid),
  offline_recovery.register_report_key(uuid, uuid, uuid, uuid, integer, bytea, bytea),
  offline_recovery.purge_server_recovery(uuid, uuid, text) from public, anon, authenticated;
revoke all on function offline_recovery.create_report_recovery_grant(uuid, uuid, uuid, text, text, integer),
  offline_recovery.consume_report_recovery_grant(uuid, uuid, uuid, text, text, integer)
from public, anon, authenticated;
grant execute on function offline_recovery.checkpoint_report_ciphertext(uuid, uuid, uuid, uuid, bigint, text),
  offline_recovery.recover_report_key(uuid, uuid, uuid, uuid),
  offline_recovery.register_report_key(uuid, uuid, uuid, uuid, integer, bytea, bytea),
  offline_recovery.purge_server_recovery(uuid, uuid, text),
  offline_recovery.create_report_recovery_grant(uuid, uuid, uuid, text, text, integer),
  offline_recovery.consume_report_recovery_grant(uuid, uuid, uuid, text, text, integer)
to open_triage_offline_runtime;
