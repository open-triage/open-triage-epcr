-- An organization is an agency. A root agency is the agency group boundary; its
-- children share identities and roles, but keep clinical/configuration ownership.
alter table app_identity.organization
  add column parent_organization_id uuid references app_identity.organization(id),
  add column hostname text unique,
  add column active boolean not null default true,
  add column revision bigint not null default 1,
  add constraint organization_hostname_valid check (hostname is null or
    (char_length(hostname) between 3 and 253 and hostname = lower(hostname)
     and hostname ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  add constraint organization_not_own_parent check (parent_organization_id <> id);
create index organization_parent_idx on app_identity.organization(parent_organization_id);

create function app_identity.organization_group(candidate uuid)
returns uuid language sql stable security invoker set search_path = '' as $$
  select coalesce(parent_organization_id, id) from app_identity.organization where id = candidate;
$$;

-- Moving an existing agency into a different group changes access to its
-- historical records. That requires a dedicated migration, not a settings edit.
create function app_identity.validate_organization_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.parent_organization_id is distinct from old.parent_organization_id then
    raise exception 'An existing agency cannot be moved between agency groups';
  end if;
  if tg_op = 'INSERT' and new.parent_organization_id is not null and not exists (
    select 1 from app_identity.organization where id = new.parent_organization_id
      and parent_organization_id is null and active
  ) then
    raise exception 'The parent must be an active root agency';
  end if;
  if not new.active and exists (select 1 from app_identity.installation_owner
    where organization_id = new.id) then
    raise exception 'The installation owner home agency must remain active';
  end if;
  return new;
end;
$$;
create trigger organization_group_valid before insert or update
  on app_identity.organization for each row execute function app_identity.validate_organization_group();

-- Do not silently choose an owner on an installation that has multiple legacy
-- owners. The operator must resolve that ambiguity before applying this upgrade.
create unique index installation_owner_singleton on app_identity.installation_owner ((true));

create function app_identity.is_installation_owner(candidate uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app_identity.installation_owner owner_record
    join app_identity.app_user account on account.id = owner_record.user_id
    where account.id = candidate and account.active);
$$;

create function app_identity.user_can_access_organization(candidate_user uuid, candidate_organization uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app_identity.app_user account
    join app_identity.organization agency on agency.id = candidate_organization and agency.active
    join app_identity.organization root on root.id = coalesce(agency.parent_organization_id, agency.id) and root.active
    where account.id = candidate_user and account.active and
      (app_identity.organization_group(account.organization_id) = root.id
        or app_identity.is_installation_owner(account.id)));
$$;

create function app_identity.validate_account_group()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'An existing account cannot be moved between agency groups';
  end if;
  if app_identity.organization_group(new.organization_id) is distinct from new.organization_id then
    raise exception 'Staff accounts must belong to the parent agency';
  end if;
  return new;
end;
$$;
create trigger account_group_valid before insert or update of organization_id on app_identity.app_user
  for each row execute function app_identity.validate_account_group();
revoke all on function app_identity.validate_account_group() from public;
grant execute on function app_identity.validate_account_group() to open_triage_api_runtime;

-- These durable relationships retain historical foreign keys after an owner
-- transfer. Live access is always computed above, never granted by this table.
create table app_identity.organization_user (
  organization_id uuid not null references app_identity.organization(id),
  user_id uuid not null references app_identity.app_user(id),
  primary key (organization_id, user_id)
);
create index organization_user_user_idx on app_identity.organization_user(user_id, organization_id);
insert into app_identity.organization_user
select agency.id, account.id from app_identity.organization agency cross join app_identity.app_user account
where app_identity.organization_group(account.organization_id) = app_identity.organization_group(agency.id)
  or app_identity.is_installation_owner(account.id);

create function app_identity.expand_organization_users()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Serialize agency/account creation so concurrent inserts cannot miss each other.
  perform pg_catalog.pg_advisory_xact_lock(691631722);
  insert into app_identity.organization_user (organization_id, user_id)
  select agency.id, account.id from app_identity.organization agency cross join app_identity.app_user account
  where (app_identity.organization_group(account.organization_id) = app_identity.organization_group(agency.id)
    or app_identity.is_installation_owner(account.id))
    and (tg_table_name = 'installation_owner' or
      (tg_table_name = 'organization' and agency.id = (to_jsonb(new)->>'id')::uuid) or
      (tg_table_name = 'app_user' and account.id = (to_jsonb(new)->>'id')::uuid))
  on conflict do nothing;
  return new;
end;
$$;
create trigger organization_expand_users after insert on app_identity.organization
  for each row execute function app_identity.expand_organization_users();
create trigger account_expand_organizations after insert on app_identity.app_user
  for each row execute function app_identity.expand_organization_users();
create trigger owner_expand_organizations after insert or update on app_identity.installation_owner
  for each row execute function app_identity.expand_organization_users();

-- Every existing tenant/user composite foreign key now references the shared
-- directory, including notes, audit actors, roles, review and offline recovery.
do $$
declare item record;
begin
  for item in select conrelid::regclass as relation, conname,
      pg_get_constraintdef(oid) as definition
    from pg_constraint where contype = 'f' and confrelid = 'app_identity.app_user'::regclass
      and array_length(confkey, 1) = 2
  loop
    execute format('alter table %s drop constraint %I', item.relation, item.conname);
    execute format('alter table %s add constraint %I %s', item.relation, item.conname,
      replace(item.definition, 'REFERENCES app_identity.app_user(organization_id, id)',
        'REFERENCES app_identity.organization_user(organization_id, user_id)'));
  end loop;
end;
$$;

create view app_identity.agency_user with (security_invoker = true) as
select membership.organization_id, account.id, account.display_name, account.active,
  account.synthetic, account.created_at, account.deactivated_at,
  account.revision, account.organization_id as home_organization_id
from app_identity.organization_user membership
join app_identity.app_user account on account.id = membership.user_id;

create or replace function app_identity.user_has_capability(
  candidate_user_id uuid, candidate_organization_id uuid, candidate_capability text
) returns boolean language sql stable security invoker as $$
  select exists (select 1 from app_identity.capability where key = candidate_capability)
    and app_identity.user_can_access_organization(candidate_user_id, candidate_organization_id)
    and (app_identity.is_installation_owner(candidate_user_id) or
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

alter table app_identity.app_session
  add column organization_id uuid references app_identity.organization(id),
  add column browser_origin text;
update app_identity.app_session session set organization_id = account.organization_id
  from app_identity.app_user account where account.id = session.user_id;
-- Pre-upgrade browser sessions have no host binding. Require a fresh sign-in.
update app_identity.app_session set revoked_at = now(), revocation_reason = 'agency_session_upgrade'
  where revoked_at is null;
alter table app_identity.app_session alter column organization_id set not null;
create index app_session_organization_idx on app_identity.app_session(organization_id);
create function app_identity.default_session_organization()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.organization_id is null then
    select organization_id into new.organization_id from app_identity.app_user where id = new.user_id;
  end if;
  if not app_identity.user_can_access_organization(new.user_id, new.organization_id) then
    raise exception 'Session organization is not accessible to this account';
  end if;
  return new;
end;
$$;
create trigger session_organization_valid before insert or update of organization_id, user_id
  on app_identity.app_session for each row execute function app_identity.default_session_organization();

create table app_identity.organization_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null references app_identity.app_user(id),
  action text not null check (action in ('agency.create', 'agency.update', 'agency.switch')),
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb
);
create index organization_event_time_idx on app_identity.organization_event(organization_id, occurred_at desc, id desc);
create trigger organization_event_append_only before update or delete on app_identity.organization_event
  for each row execute function public.prevent_update_or_delete();

revoke all on app_identity.organization_user, app_identity.agency_user, app_identity.organization_event from public;
revoke all on function app_identity.organization_group(uuid), app_identity.is_installation_owner(uuid),
  app_identity.user_can_access_organization(uuid, uuid), app_identity.validate_organization_group(),
  app_identity.expand_organization_users(), app_identity.default_session_organization() from public;
grant select, insert, update on app_identity.organization to open_triage_api_runtime;
grant select, insert on app_identity.organization_user to open_triage_api_runtime;
grant select on app_identity.agency_user to open_triage_api_runtime;
grant select, insert on app_identity.organization_event to open_triage_api_runtime;
grant usage on sequence app_identity.organization_event_id_seq to open_triage_api_runtime;
grant execute on function app_identity.organization_group(uuid), app_identity.is_installation_owner(uuid),
  app_identity.user_can_access_organization(uuid, uuid), app_identity.validate_organization_group(),
  app_identity.expand_organization_users(), app_identity.default_session_organization()
  to open_triage_api_runtime;

CREATE OR REPLACE FUNCTION clinical.validate_amendment()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  report_status text;
  report_organization_id uuid;
  next_sequence integer;
begin
  select status, organization_id into report_status, report_organization_id
  from clinical.report where id = new.report_id for update;
  if report_status <> 'signed' then raise exception 'only a signed report may be amended'; end if;
  if not exists (select 1 from app_identity.agency_user
      where id = new.author_id and organization_id = report_organization_id and active) then
    raise exception 'amendment author must be an active user in the report organization';
  end if;
  select coalesce(max(sequence), 0) + 1 into next_sequence from clinical.amendment where report_id = new.report_id;
  if new.sequence <> next_sequence then raise exception 'amendment sequence must be %, received %', next_sequence, new.sequence; end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION forms.validate_agency_stationary_default()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  version_organization_id uuid;
  version_status text;
  actor_organization_id uuid;
begin
  select f.organization_id, fv.status
    into version_organization_id, version_status
  from forms.form_version fv
  join forms.form f on f.id = fv.form_id
  where fv.id = new.form_version_id;

  select organization_id into actor_organization_id
  from app_identity.agency_user where id = new.activated_by and organization_id = new.organization_id and active;

  if version_organization_id is distinct from new.organization_id or version_status <> 'published' then
    raise exception 'agency Stationary default must be a published form version from the same organization';
  end if;
  if actor_organization_id is distinct from new.organization_id then
    raise exception 'activation actor must be active in the same organization';
  end if;
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION offline_recovery.consume_report_recovery_grant(candidate_report_id uuid, candidate_organization_id uuid, candidate_user_id uuid, candidate_session_token_sha256 text, candidate_grant_token_sha256 text, candidate_envelope_version integer)
 RETURNS TABLE(result text, recovery_handle uuid, wrapping_key_version integer, wrapping_nonce bytea, wrapped_data_key bytea)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and session.organization_id = candidate_organization_id and app_user.active
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
$function$;


CREATE OR REPLACE FUNCTION offline_recovery.create_report_recovery_grant(candidate_report_id uuid, candidate_organization_id uuid, candidate_user_id uuid, candidate_session_token_sha256 text, candidate_grant_token_sha256 text, candidate_envelope_version integer)
 RETURNS TABLE(result text, recovery_handle uuid, grant_id uuid, expires_at timestamp with time zone, report_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and session.organization_id = candidate_organization_id
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
$function$;


CREATE OR REPLACE FUNCTION offline_recovery.recover_report_key(candidate_report_id uuid, candidate_organization_id uuid, candidate_owner_user_id uuid, candidate_recovery_handle uuid)
 RETURNS TABLE(wrapping_key_version integer, wrapping_nonce bytea, wrapped_data_key bytea)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      select 1 from app_identity.agency_user owner
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
$function$;


CREATE OR REPLACE FUNCTION offline_recovery.register_report_key(candidate_report_id uuid, candidate_organization_id uuid, candidate_owner_user_id uuid, candidate_recovery_handle uuid, candidate_wrapping_key_version integer, candidate_wrapping_nonce bytea, candidate_wrapped_data_key bytea)
 RETURNS TABLE(recovery_handle uuid, recovery_deadline timestamp with time zone, wrapping_key_version integer, created boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare selected_window integer; selected_expiry timestamptz;
  selected_deadline timestamptz; inserted_row offline_recovery.report_key_envelope%rowtype;
begin
  if exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then return; end if;
  select organization.offline_recovery_window_hours, report.expires_at into selected_window, selected_expiry
  from clinical.report report
  join app_identity.agency_user owner on owner.id = report.documenting_user_id
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
$function$;

grant execute on function app_identity.seed_protected_roles(uuid), app_identity.seed_protected_roles_for_organization(),
  app_identity.seed_agency_settings_for_organization(), app_identity.validate_role_version(uuid) to open_triage_api_runtime;
