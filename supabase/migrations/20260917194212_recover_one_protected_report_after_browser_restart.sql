create table offline_recovery.report_recovery_grant (
  id uuid primary key default gen_random_uuid(),
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  session_id uuid not null references app_identity.app_session(id) on delete cascade,
  user_id uuid not null,
  organization_id uuid not null,
  report_id uuid not null references clinical.report(id) on delete cascade,
  envelope_version integer not null check (envelope_version = 1),
  required_capability text not null check (required_capability = 'clinical:document'),
  owner_user_id uuid not null,
  eligible_report_state text not null check (eligible_report_state = 'draft'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  foreign key (organization_id, user_id)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, owner_user_id)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, report_id)
    references clinical.report(organization_id, id) on delete cascade,
  check (owner_user_id = user_id),
  check (expires_at = created_at + interval '60 seconds'),
  check (consumed_at is null or consumed_at >= created_at)
);

create index report_recovery_grant_active_token_idx
  on offline_recovery.report_recovery_grant (token_sha256, expires_at)
  where consumed_at is null;

create index report_recovery_grant_expiry_idx
  on offline_recovery.report_recovery_grant (expires_at)
  where consumed_at is null;

create table offline_recovery.report_recovery_event (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  report_id uuid,
  session_id uuid,
  grant_id uuid,
  action text not null check (action in ('grant', 'consume')),
  outcome text not null check (outcome in ('succeeded', 'denied')),
  reason text not null check (reason in (
    'allowed', 'missing', 'expired', 'purged', 'unauthorized',
    'wrong_owner', 'ineligible_state', 'reauthentication_required',
    'grant_expired', 'replayed', 'binding_mismatch'
  )),
  occurred_at timestamptz not null default now()
);

create index report_recovery_event_organization_time_idx
  on offline_recovery.report_recovery_event (organization_id, occurred_at desc);

create trigger report_recovery_event_append_only
before update or delete on offline_recovery.report_recovery_event
for each row execute function public.prevent_update_or_delete();

revoke all on offline_recovery.report_recovery_grant,
  offline_recovery.report_recovery_event from public;

create function offline_recovery.create_report_recovery_grant(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_session_token_sha256 text,
  candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (
  result text,
  recovery_handle uuid,
  grant_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_session app_identity.app_session%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_policy boolean;
  selected_reason text;
  selected_grant_id uuid;
  selected_expires_at timestamptz;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.expire_due_report_keys();

  select session.* into selected_session
  from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  join app_identity.local_credential credential on credential.user_id = app_user.id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and app_user.organization_id = candidate_organization_id
    and app_user.active
    and session.revoked_at is null
    and session.expires_at > selected_now
    and session.credential_version = credential.credential_version;

  if selected_session.id is null then
    selected_reason := 'unauthorized';
  elsif not app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document'
  ) then
    selected_reason := 'unauthorized';
  else
    select report.* into selected_report
    from clinical.report report where report.id = candidate_report_id;
    if selected_report.id is null then
      selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then
      selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then
      selected_reason := 'wrong_owner';
    elsif selected_report.status <> 'draft' then
      selected_reason := 'ineligible_state';
    else
      select envelope.* into selected_envelope
      from offline_recovery.report_key_envelope envelope
      where envelope.report_id = candidate_report_id;
      if selected_envelope.report_id is null
        or selected_envelope.envelope_version <> candidate_envelope_version then
        selected_reason := 'missing';
      elsif selected_envelope.organization_id <> candidate_organization_id
        or selected_envelope.owner_user_id <> candidate_user_id then
        selected_reason := 'wrong_owner';
      elsif selected_envelope.state = 'purged' then
        selected_reason := 'purged';
      elsif selected_envelope.state = 'expired'
        or selected_envelope.recovery_deadline <= selected_now then
        selected_reason := 'expired';
      elsif selected_envelope.state <> 'live'
        or selected_envelope.wrapping_nonce is null
        or selected_envelope.wrapped_data_key is null then
        selected_reason := 'unauthorized';
      end if;
    end if;
  end if;

  if selected_reason is null then
    select organization.offline_recovery_restart_reauthentication_required
      into selected_policy
    from app_identity.organization organization
    where organization.id = candidate_organization_id;
    if selected_policy and greatest(
      selected_session.created_at,
      coalesce(selected_session.reauthenticated_at, selected_session.created_at)
    ) < selected_now - interval '5 minutes' then
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
      null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  insert into offline_recovery.report_recovery_grant
    (token_sha256, session_id, user_id, organization_id, report_id,
     envelope_version, required_capability, owner_user_id,
     eligible_report_state, created_at, expires_at)
  values (candidate_grant_token_sha256, selected_session.id,
    candidate_user_id, candidate_organization_id, candidate_report_id,
    candidate_envelope_version, 'clinical:document', candidate_user_id,
    'draft', selected_now, selected_now + interval '60 seconds')
  returning id, report_recovery_grant.expires_at
    into selected_grant_id, selected_expires_at;

  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id,
     action, outcome, reason)
  values (candidate_organization_id, candidate_user_id, candidate_report_id,
    selected_session.id, selected_grant_id, 'grant', 'succeeded', 'allowed');

  return query select 'created'::text, selected_envelope.recovery_handle,
    selected_grant_id, selected_expires_at;
end;
$$;

create function offline_recovery.consume_report_recovery_grant(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_session_token_sha256 text,
  candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (
  result text,
  recovery_handle uuid,
  wrapping_key_version integer,
  wrapping_nonce bytea,
  wrapped_data_key bytea
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_session app_identity.app_session%rowtype;
  selected_grant offline_recovery.report_recovery_grant%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  released_key record;
  selected_policy boolean;
  selected_reason text;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.expire_due_report_keys();

  select session.* into selected_session
  from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  join app_identity.local_credential credential on credential.user_id = app_user.id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and app_user.organization_id = candidate_organization_id
    and app_user.active
    and session.revoked_at is null
    and session.expires_at > selected_now
    and session.credential_version = credential.credential_version;

  select grant_row.* into selected_grant
  from offline_recovery.report_recovery_grant grant_row
  where grant_row.token_sha256 = candidate_grant_token_sha256
  for update;

  if selected_session.id is null then
    selected_reason := 'unauthorized';
  elsif selected_grant.id is null then
    selected_reason := 'missing';
  elsif selected_grant.consumed_at is not null then
    selected_reason := 'replayed';
  elsif selected_grant.expires_at <= selected_now then
    selected_reason := 'grant_expired';
  elsif selected_grant.session_id <> selected_session.id
    or selected_grant.user_id <> candidate_user_id
    or selected_grant.organization_id <> candidate_organization_id
    or selected_grant.report_id <> candidate_report_id
    or selected_grant.envelope_version <> candidate_envelope_version
    or selected_grant.owner_user_id <> candidate_user_id
    or selected_grant.required_capability <> 'clinical:document'
    or selected_grant.eligible_report_state <> 'draft' then
    selected_reason := 'binding_mismatch';
  else
    select organization.offline_recovery_restart_reauthentication_required
      into selected_policy
    from app_identity.organization organization
    where organization.id = candidate_organization_id;
    if selected_policy and greatest(
      selected_session.created_at,
      coalesce(selected_session.reauthenticated_at, selected_session.created_at)
    ) < selected_now - interval '5 minutes' then
      selected_reason := 'reauthentication_required';
    end if;
  end if;

  if selected_reason is null and not app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document'
  ) then
    selected_reason := 'unauthorized';
  elsif selected_reason is null then
    select report.* into selected_report
    from clinical.report report where report.id = candidate_report_id;
    if selected_report.id is null then
      selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then
      selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then
      selected_reason := 'wrong_owner';
    elsif selected_report.status <> 'draft' then
      selected_reason := 'ineligible_state';
    else
      select envelope.* into selected_envelope
      from offline_recovery.report_key_envelope envelope
      where envelope.report_id = candidate_report_id;
      if selected_envelope.report_id is null
        or selected_envelope.envelope_version <> candidate_envelope_version then
        selected_reason := 'missing';
      elsif selected_envelope.organization_id <> candidate_organization_id
        or selected_envelope.owner_user_id <> candidate_user_id then
        selected_reason := 'wrong_owner';
      elsif selected_envelope.state = 'purged' then
        selected_reason := 'purged';
      elsif selected_envelope.state = 'expired'
        or selected_envelope.recovery_deadline <= selected_now then
        selected_reason := 'expired';
      elsif selected_envelope.state <> 'live'
        or selected_envelope.wrapping_nonce is null
        or selected_envelope.wrapped_data_key is null then
        selected_reason := 'unauthorized';
      end if;
    end if;
  end if;

  if selected_reason is null then
    select * into released_key
    from offline_recovery.recover_report_key(
      candidate_report_id, candidate_organization_id,
      candidate_user_id, selected_envelope.recovery_handle
    );
    if not found then selected_reason := 'expired'; end if;
  end if;

  if selected_reason is not null then
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, grant_id,
       action, outcome, reason)
    values (candidate_organization_id, candidate_user_id, candidate_report_id,
      selected_session.id, selected_grant.id, 'consume', 'denied', selected_reason);
    return query select 'denied'::text, null::uuid, null::integer,
      null::bytea, null::bytea;
    return;
  end if;

  update offline_recovery.report_recovery_grant
  set consumed_at = selected_now
  where id = selected_grant.id and consumed_at is null;

  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id,
     action, outcome, reason)
  values (candidate_organization_id, candidate_user_id, candidate_report_id,
    selected_session.id, selected_grant.id, 'consume', 'succeeded', 'allowed');

  return query select 'consumed'::text, selected_envelope.recovery_handle,
    released_key.wrapping_key_version::integer,
    released_key.wrapping_nonce::bytea, released_key.wrapped_data_key::bytea;
end;
$$;

revoke all on function offline_recovery.create_report_recovery_grant(
  uuid, uuid, uuid, text, text, integer
), offline_recovery.consume_report_recovery_grant(
  uuid, uuid, uuid, text, text, integer
) from public;

grant execute on function offline_recovery.create_report_recovery_grant(
  uuid, uuid, uuid, text, text, integer
), offline_recovery.consume_report_recovery_grant(
  uuid, uuid, uuid, text, text, integer
) to open_triage_offline_runtime;
