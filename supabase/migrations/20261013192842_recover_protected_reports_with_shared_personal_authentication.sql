-- Recovery uses immutable application identity and the same personal proof as
-- sensitive actions. Login activity, pairing and policy changes cannot renew it.
create function offline_recovery.session_has_recovery_proof(candidate app_identity.app_session, at_time timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((coalesce(candidate.personally_authenticated_at, candidate.reauthenticated_at) between at_time - interval '5 minutes' and at_time
    and (candidate.personal_authentication_purpose = 'reauthenticate'
      or candidate.personal_authentication_purpose is null and candidate.reauthenticated_at is not null)), false)
$$;

-- Match the shared personal-authority -> registration -> agency -> unit ->
-- session -> domain lock order so containment cannot race key release.
create function offline_recovery.lock_recovery_authority(candidate_report uuid, agency_id uuid, candidate_user uuid, token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare registration_id uuid; unit_id uuid;
begin
  perform u.id from app_identity.app_user u where u.id=candidate_user for share;
  perform a.id from app_identity.user_role_assignment a where a.user_id=candidate_user and a.ended_at is null order by a.id for share;
  perform r.id from app_identity.role r where r.id in(select a.role_id from app_identity.user_role_assignment a where a.user_id=candidate_user and a.ended_at is null) order by r.id for share;
  select s.installation_registration_id into registration_id from app_identity.app_session s where s.token_sha256=token_hash;
  select r.unit_id into unit_id from app_identity.installation_registration r where r.id=registration_id for share;
  perform o.id from app_identity.organization o where o.id=agency_id or o.id=app_identity.organization_group(agency_id) order by o.id for share;
  perform u.id from app_identity.operational_unit u where u.id=unit_id for share;
  perform s.id from app_identity.app_session s where s.token_sha256=token_hash for update;
  perform r.id from clinical.report r where r.id=candidate_report for share;
  perform e.report_id from offline_recovery.report_key_envelope e where e.report_id=candidate_report for update;
end $$;
revoke all on function offline_recovery.session_has_recovery_proof(app_identity.app_session,timestamptz),
  offline_recovery.lock_recovery_authority(uuid,uuid,uuid,text) from public;

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
begin
  if exists (select 1 from offline_recovery.report_purge_tombstone
    where report_id = candidate_report_id) then return; end if;
  return query
  update offline_recovery.report_key_envelope envelope
  set state = case when envelope.state = 'locked' then 'live' else envelope.state end,
    updated_at = now()
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state in ('live', 'locked', 'completed')
    and envelope.recovery_deadline > clock_timestamp()
    and envelope.wrapping_nonce is not null
    and envelope.wrapped_data_key is not null
    and exists (
      select 1 from app_identity.app_user owner
      where owner.id = candidate_owner_user_id
        and app_identity.user_can_access_organization(owner.id, candidate_organization_id)
        and owner.active
    )
    and app_identity.user_has_capability(
      candidate_owner_user_id, candidate_organization_id,
      'clinical:document'
    )
  returning envelope.wrapping_key_version, envelope.wrapping_nonce,
    envelope.wrapped_data_key;

  if found then
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, actor_user_id, organization_id, report_id,
       policy_version, outcome, reason_code)
    values ('recovery', 'clinician', candidate_owner_user_id,
      candidate_organization_id, candidate_report_id,
      'offline-recovery-v1', 'succeeded', 'owner_reauthenticated');
  end if;
end;
$$;

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
    and app_identity.session_authentication_valid(session)
    and (session.installation_registration_id is null or exists (
      select 1 from app_identity.installation_registration i
      join app_identity.operational_unit unit on unit.id=i.unit_id and unit.organization_id=i.organization_id
      join app_identity.organization agency on agency.id=i.organization_id
      join app_identity.organization agency_group on agency_group.id=app_identity.organization_group(agency.id)
      where i.id=session.installation_registration_id and i.revoked_at is null
        and unit.active and agency.active and agency_group.active));

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

  if selected_reason is null then
    if not offline_recovery.session_has_recovery_proof(selected_session, selected_now) then
      selected_reason := 'reauthentication_required';
    end if;
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
    and app_identity.session_authentication_valid(session)
    and (session.installation_registration_id is null or exists (
      select 1 from app_identity.installation_registration i
      join app_identity.operational_unit unit on unit.id=i.unit_id and unit.organization_id=i.organization_id
      join app_identity.organization agency on agency.id=i.organization_id
      join app_identity.organization agency_group on agency_group.id=app_identity.organization_group(agency.id)
      where i.id=session.installation_registration_id and i.revoked_at is null
        and unit.active and agency.active and agency_group.active));
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
    if not offline_recovery.session_has_recovery_proof(selected_session, selected_now) then selected_reason := 'reauthentication_required'; end if;
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

-- Only the one-use report/session/user-bound grant may release a key to runtime.
revoke execute on function offline_recovery.recover_report_key(uuid,uuid,uuid,uuid)
  from open_triage_offline_runtime;

-- A recovered browser initialization is a read snapshot, not fresh pending work.
create function offline_recovery.record_browser_ciphertext_write(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_recovery_handle uuid,
  candidate_local_record_id uuid,
  candidate_ciphertext_revision bigint,
  candidate_ciphertext_sha256 text,
  candidate_preserve_recovery_deadline boolean
)
returns table (recovery_deadline timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_window integer;
  selected_report_expiry timestamptz;
  selected_deadline timestamptz;
  selected_now timestamptz := clock_timestamp();
  prior_revision bigint;
begin
  if candidate_local_record_id is null or candidate_ciphertext_revision < 1
     or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then return; end if;
  perform offline_recovery.expire_due_report_keys(selected_now);

  -- The parent lock serializes writes for the same report and prevents a
  -- concurrent purge or expiry from racing this browser's receipt.
  select envelope.* into selected_envelope
  from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state = 'live'
    and envelope.recovery_deadline > selected_now
  for update;
  if not found or exists (select 1 from offline_recovery.report_purge_tombstone
      where report_id = candidate_report_id) then return; end if;

  select organization.offline_recovery_window_hours, report.expires_at
    into selected_window, selected_report_expiry
  from clinical.report report
  join app_identity.organization organization on organization.id = report.organization_id
  where report.id = candidate_report_id
    and report.organization_id = candidate_organization_id
    and report.documenting_user_id = candidate_owner_user_id
    and report.status = 'draft';
  if not found then return; end if;

  select browser.ciphertext_revision into prior_revision
  from offline_recovery.report_browser_ciphertext browser
  where browser.report_id = candidate_report_id
    and browser.local_record_id = candidate_local_record_id;
  if prior_revision is not null and candidate_ciphertext_revision <= prior_revision then return; end if;

  selected_deadline := case when candidate_preserve_recovery_deadline then selected_envelope.recovery_deadline
    else selected_now + make_interval(hours => selected_window) end;
  if selected_report_expiry is not null then
    selected_deadline := least(selected_deadline, selected_report_expiry);
  end if;
  if selected_deadline <= selected_now then return; end if;

  insert into offline_recovery.report_browser_ciphertext
    (report_id, local_record_id, ciphertext_revision, ciphertext_sha256, updated_at)
  values (candidate_report_id, candidate_local_record_id,
    candidate_ciphertext_revision, candidate_ciphertext_sha256, selected_now)
  on conflict (report_id, local_record_id) do update
  set ciphertext_revision = excluded.ciphertext_revision,
      ciphertext_sha256 = excluded.ciphertext_sha256,
      updated_at = selected_now;

  update offline_recovery.report_key_envelope envelope
  set recovery_deadline = greatest(envelope.recovery_deadline, selected_deadline),
      updated_at = selected_now
  where envelope.report_id = candidate_report_id;

  insert into offline_recovery.event
    (organization_id, report_id, recovery_handle, event_type,
     ciphertext_revision, occurred_at)
  values (candidate_organization_id, candidate_report_id,
    candidate_recovery_handle, 'ciphertext_written',
    candidate_ciphertext_revision, selected_now);

  return query select greatest(selected_envelope.recovery_deadline, selected_deadline);
end;
$$;

revoke all on function offline_recovery.record_browser_ciphertext_write(uuid,uuid,uuid,uuid,uuid,bigint,text,boolean) from public;
grant execute on function offline_recovery.record_browser_ciphertext_write(uuid,uuid,uuid,uuid,uuid,bigint,text,boolean) to open_triage_offline_runtime;
