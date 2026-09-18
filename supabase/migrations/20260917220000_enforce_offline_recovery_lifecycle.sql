-- Protected offline recovery follows current clinical authority without
-- extending an envelope's original deadline.  A role loss locks recoverable
-- work, while account containment destroys the wrapped key material.

alter table offline_recovery.report_recovery_event
  drop constraint report_recovery_event_action_check,
  add constraint report_recovery_event_action_check
    check (action in ('grant', 'consume', 'revoke')),
  drop constraint report_recovery_event_outcome_check,
  add constraint report_recovery_event_outcome_check
    check (outcome in ('succeeded', 'denied', 'revoked')),
  drop constraint report_recovery_event_reason_check,
  add constraint report_recovery_event_reason_check check (reason in (
    'allowed', 'missing', 'expired', 'purged', 'unauthorized',
    'wrong_owner', 'ineligible_state', 'reauthentication_required',
    'grant_expired', 'replayed', 'binding_mismatch',
    'authorization_revoked', 'password_reset', 'account_containment',
    'administrative_recovery_purge'
  ));

create function offline_recovery.revoke_user_recovery_grants(
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  with revoked as (
    delete from offline_recovery.report_recovery_grant grant_row
    where grant_row.organization_id = candidate_organization_id
      and grant_row.user_id = candidate_user_id
      and grant_row.consumed_at is null
    returning grant_row.*
  ), audited as (
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, grant_id,
       action, outcome, reason)
    select organization_id, user_id, report_id, session_id, id,
      'revoke', 'revoked', candidate_reason
    from revoked
    returning 1
  ) select count(*) into changed from audited;
  return changed;
end;
$$;

create function offline_recovery.reconcile_user_clinical_authority(
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_reason text default 'authorization_revoked'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  if app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document'
  ) then
    return 0;
  end if;

  perform offline_recovery.revoke_user_recovery_grants(
    candidate_organization_id, candidate_user_id, 'authorization_revoked'
  );

  with locked as (
    update offline_recovery.report_key_envelope envelope
    set state = 'locked', updated_at = now()
    where envelope.organization_id = candidate_organization_id
      and envelope.owner_user_id = candidate_user_id
      and envelope.state = 'live'
      and envelope.recovery_deadline > now()
    returning envelope.organization_id, envelope.report_id,
      envelope.wrapping_key_version
  ), audited as (
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, organization_id, report_id, policy_version,
       outcome, reason_code, wrapping_key_version)
    select 'authorization_lock', 'system', organization_id, report_id,
      'offline-recovery-v1', 'locked', candidate_reason, wrapping_key_version
    from locked
    returning 1
  ) select count(*) into changed from audited;
  return changed;
end;
$$;

create or replace function offline_recovery.purge_account_recovery(
  candidate_organization_id uuid,
  candidate_owner_user_id uuid,
  candidate_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  insert into offline_recovery.report_purge_tombstone
    (report_id, organization_id, reason_code)
  select envelope.report_id, envelope.organization_id, candidate_reason_code
  from offline_recovery.report_key_envelope envelope
  where envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
  on conflict (report_id) do nothing;

  with purged as (
    delete from offline_recovery.report_key_envelope envelope
    where envelope.organization_id = candidate_organization_id
      and envelope.owner_user_id = candidate_owner_user_id
    returning envelope.organization_id, envelope.report_id,
      envelope.wrapping_key_version
  ), audited as (
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, organization_id, report_id, policy_version,
       outcome, reason_code, wrapping_key_version)
    select 'account_purge', 'system', organization_id, report_id,
      'offline-recovery-v1', 'purged', candidate_reason_code,
      wrapping_key_version from purged returning 1
  ) select count(*) into changed from audited;
  return changed;
end;
$$;

create function offline_recovery.purge_user_recovery_as_administrator(
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_actor_user_id uuid,
  candidate_reason_code text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare changed integer;
begin
  perform offline_recovery.revoke_user_recovery_grants(
    candidate_organization_id, candidate_user_id,
    'administrative_recovery_purge'
  );

  insert into offline_recovery.report_purge_tombstone
    (report_id, organization_id, reason_code)
  select envelope.report_id, envelope.organization_id, candidate_reason_code
  from offline_recovery.report_key_envelope envelope
  where envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_user_id
  on conflict (report_id) do nothing;

  with purged as (
    delete from offline_recovery.report_key_envelope envelope
    where envelope.organization_id = candidate_organization_id
      and envelope.owner_user_id = candidate_user_id
    returning envelope.organization_id, envelope.report_id,
      envelope.wrapping_key_version
  ), audited as (
    insert into offline_recovery.key_lifecycle_event
      (event_type, actor_kind, actor_user_id, organization_id, report_id,
       policy_version, outcome, reason_code, wrapping_key_version)
    select 'administrative_recovery_purge', 'administrator',
      candidate_actor_user_id, organization_id, report_id,
      'offline-recovery-v1', 'purged', candidate_reason_code,
      wrapping_key_version
    from purged
    returning 1
  ) select count(*) into changed from audited;
  return changed;
end;
$$;

-- Recovery after restored clinical authority is the only operation that can
-- transition a locked envelope back to live.  Its deadline is unchanged.
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
    and envelope.recovery_deadline > now()
    and envelope.wrapping_nonce is not null
    and envelope.wrapped_data_key is not null
    and exists (
      select 1 from app_identity.app_user owner
      where owner.id = candidate_owner_user_id
        and owner.organization_id = candidate_organization_id
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

-- Grant creation accepts a locked envelope only after authority has been
-- restored.  The consume function performs the actual unlock atomically.
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
    and app_user.active and session.revoked_at is null
    and session.expires_at > selected_now
    and session.credential_version = credential.credential_version;

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
    select organization.offline_recovery_restart_reauthentication_required
      into selected_policy from app_identity.organization organization
      where organization.id = candidate_organization_id;
    if selected_policy and greatest(selected_session.created_at,
      coalesce(selected_session.reauthenticated_at, selected_session.created_at))
      < selected_now - interval '5 minutes' then
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
    selected_report.status, selected_now, selected_now + interval '60 seconds')
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

create function offline_recovery.on_role_assignment_authority_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform offline_recovery.reconcile_user_clinical_authority(
      old.organization_id, old.user_id, 'clinical_role_removed'
    );
    return old;
  end if;
  perform offline_recovery.reconcile_user_clinical_authority(
    new.organization_id, new.user_id, 'clinical_role_removed'
  );
  return new;
end;
$$;

create constraint trigger offline_recovery_role_assignment_authority
after insert or update or delete on app_identity.user_role_assignment
deferrable initially deferred for each row
execute function offline_recovery.on_role_assignment_authority_change();

create function offline_recovery.on_role_definition_authority_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare affected_user record;
begin
  for affected_user in
    select assignment.organization_id, assignment.user_id
    from app_identity.user_role_assignment assignment
    where assignment.organization_id = new.organization_id
      and assignment.role_id = new.id and assignment.ended_at is null
  loop
    perform offline_recovery.reconcile_user_clinical_authority(
      affected_user.organization_id, affected_user.user_id,
      'clinical_role_definition_changed'
    );
  end loop;
  return new;
end;
$$;

create constraint trigger offline_recovery_role_definition_authority
after update of active, assignable, current_version_id on app_identity.role
deferrable initially deferred for each row
execute function offline_recovery.on_role_definition_authority_change();

create function offline_recovery.on_account_containment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform offline_recovery.revoke_user_recovery_grants(
      old.organization_id, old.id, 'account_containment'
    );
    perform offline_recovery.purge_account_recovery(
      old.organization_id, old.id, 'account_deleted'
    );
    update app_identity.app_session set revoked_at = now(),
      revocation_reason = 'account_deleted'
    where user_id = old.id and revoked_at is null;
    return old;
  end if;
  if (old.active and not new.active) or old.organization_id <> new.organization_id then
    perform offline_recovery.revoke_user_recovery_grants(
      old.organization_id, old.id, 'account_containment'
    );
    perform offline_recovery.purge_account_recovery(
      old.organization_id, old.id,
      case when old.organization_id <> new.organization_id
        then 'organization_removed' else 'account_deactivated' end
    );
    update app_identity.app_session set revoked_at = now(),
      revocation_reason = case when old.organization_id <> new.organization_id
        then 'organization_removed' else 'account_disabled' end
    where user_id = old.id and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger offline_recovery_account_containment
before update of active, organization_id or delete on app_identity.app_user
for each row execute function offline_recovery.on_account_containment();

alter table app_identity.authentication_event
  drop constraint authentication_event_action_check,
  add constraint authentication_event_action_check check (action in (
    'account.provision', 'account.reset_password', 'account.identity_change',
    'account.disable', 'account.reactivate', 'account.roles_change',
    'authentication.sign_in', 'authentication.password_change',
    'authentication.reauthenticate', 'authentication.sign_out',
    'authentication.session_revoke', 'offline_recovery.administrative_purge'
  ));

revoke all on function offline_recovery.revoke_user_recovery_grants(uuid, uuid, text),
  offline_recovery.reconcile_user_clinical_authority(uuid, uuid, text),
  offline_recovery.purge_account_recovery(uuid, uuid, text),
  offline_recovery.purge_user_recovery_as_administrator(uuid, uuid, uuid, text),
  offline_recovery.on_role_assignment_authority_change(),
  offline_recovery.on_role_definition_authority_change(),
  offline_recovery.on_account_containment()
from public;

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

grant execute on function offline_recovery.revoke_user_recovery_grants(uuid, uuid, text),
  offline_recovery.reconcile_user_clinical_authority(uuid, uuid, text),
  offline_recovery.purge_account_recovery(uuid, uuid, text),
  offline_recovery.create_report_recovery_grant(uuid, uuid, uuid, text, text, integer),
  offline_recovery.recover_report_key(uuid, uuid, uuid, uuid)
to open_triage_offline_runtime;

grant execute on function offline_recovery.purge_user_recovery_as_administrator(uuid, uuid, uuid, text)
to open_triage_offline_recovery_purger;

comment on function offline_recovery.purge_user_recovery_as_administrator(uuid, uuid, uuid, text) is
  'Cryptographically destroys every recoverable browser envelope for one user without reading report content.';
