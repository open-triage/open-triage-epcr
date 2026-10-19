-- Reopening protected reports uses the existing authenticated session.
-- Preserve ownership, capability, session validity, expiry, single-use grants,
-- audit events, and existing private function owners and ACLs.

create or replace function offline_recovery.create_report_recovery_grant(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_session_token_sha256 text,
  candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (result text, recovery_handle uuid, grant_id uuid,
  expires_at timestamptz, report_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_session app_identity.app_session%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_reason text;
  selected_grant_id uuid;
  selected_expires_at timestamptz;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.lock_recovery_authority(candidate_report_id, candidate_organization_id, candidate_user_id, candidate_session_token_sha256);
  selected_now := clock_timestamp();
  select session.* into selected_session
  from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and session.organization_id = candidate_organization_id
    and app_identity.user_can_access_organization(app_user.id, candidate_organization_id)
    and app_user.active and session.revoked_at is null
    and session.expires_at > selected_now
    and app_identity.session_authentication_valid(session);

  if selected_session.id is null or not app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document'
  ) then selected_reason := 'unauthorized';
  elsif exists (select 1 from offline_recovery.report_purge_tombstone
    where report_id = candidate_report_id) then selected_reason := 'purged';
  else
    select report.* into selected_report from clinical.report report
      where report.id = candidate_report_id;
    if selected_report.id is null then selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
    else
      select envelope.* into selected_envelope
      from offline_recovery.report_key_envelope envelope
      where envelope.report_id = candidate_report_id;
      if selected_envelope.report_id is null or selected_envelope.envelope_version <> candidate_envelope_version then selected_reason := 'missing';
      elsif selected_envelope.organization_id <> candidate_organization_id or selected_envelope.owner_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
      elsif selected_envelope.state = 'purged' then selected_reason := 'purged';
      elsif selected_envelope.state = 'expired' or selected_envelope.recovery_deadline <= selected_now then selected_reason := 'expired';
      elsif selected_report.status = 'draft'
        and selected_envelope.state not in ('live', 'locked') then selected_reason := 'unauthorized';
      elsif selected_report.status = 'signed'
        and selected_envelope.state <> 'completed' then selected_reason := 'ineligible_state';
      elsif selected_report.status not in ('draft', 'signed')
        or selected_envelope.wrapping_nonce is null
        or selected_envelope.wrapped_data_key is null then selected_reason := 'ineligible_state';
      end if;
    end if;
  end if;

  if selected_reason is not null then
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, action, outcome, reason)
    values (candidate_organization_id, candidate_user_id, candidate_report_id,
      selected_session.id, 'grant', 'denied', selected_reason);
    return query select 'denied'::text,
      null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  -- Restored authority makes the envelope eligible again, but never changes
  -- its fixed recovery deadline or exposes key material.
  update offline_recovery.report_key_envelope envelope
  set state = 'live', updated_at = selected_now
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_user_id
    and envelope.state = 'locked'
    and envelope.recovery_deadline > selected_now;

  insert into offline_recovery.report_recovery_grant
    (token_sha256, session_id, user_id, organization_id, report_id,
     envelope_version, required_capability, owner_user_id,
     eligible_report_state, created_at, expires_at)
  values (candidate_grant_token_sha256, selected_session.id,
    candidate_user_id, candidate_organization_id, candidate_report_id,
    candidate_envelope_version, 'clinical:document', candidate_user_id,
    selected_report.status, selected_now, least(selected_now + interval '60 seconds', selected_session.expires_at, selected_envelope.recovery_deadline))
  returning id, report_recovery_grant.expires_at
    into selected_grant_id, selected_expires_at;

  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id,
     action, outcome, reason)
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
  released_key record; selected_reason text;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.lock_recovery_authority(candidate_report_id, candidate_organization_id, candidate_user_id, candidate_session_token_sha256);
  selected_now := clock_timestamp();
  select session.* into selected_session from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and session.organization_id = candidate_organization_id
    and app_identity.user_can_access_organization(app_user.id, candidate_organization_id) and app_user.active
    and session.revoked_at is null and session.expires_at > selected_now
    and app_identity.session_authentication_valid(session);
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
