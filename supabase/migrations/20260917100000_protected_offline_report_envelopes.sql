alter table app_identity.organization
  add column offline_recovery_window_hours integer not null default 24,
  add column offline_recovery_restart_reauthentication_required boolean not null default true,
  add constraint organization_offline_recovery_window_check
    check (offline_recovery_window_hours between 1 and 168);

create schema offline_recovery;
revoke all on schema offline_recovery from public;

create table offline_recovery.report_key_envelope (
  report_id uuid primary key references clinical.report(id) on delete cascade,
  organization_id uuid not null,
  owner_user_id uuid not null,
  recovery_handle uuid not null unique,
  envelope_version integer not null default 1 check (envelope_version = 1),
  wrapping_key_version integer not null check (wrapping_key_version > 0),
  wrapping_nonce bytea not null check (octet_length(wrapping_nonce) = 12),
  wrapped_data_key bytea not null check (octet_length(wrapped_data_key) = 48),
  ciphertext_revision bigint not null default 0 check (ciphertext_revision >= 0),
  ciphertext_sha256 text check (ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  recovery_deadline timestamptz not null,
  state text not null default 'live' check (state in ('live', 'expired', 'purged')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, owner_user_id)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, report_id)
    references clinical.report(organization_id, id) on delete cascade,
  check (recovery_deadline > created_at)
);

create index report_key_envelope_deadline_idx
  on offline_recovery.report_key_envelope (recovery_deadline, report_id)
  where state = 'live';

revoke all on offline_recovery.report_key_envelope from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_offline_runtime') then
    create role open_triage_offline_runtime nologin;
  end if;
end;
$$;

create function offline_recovery.register_report_key(
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

  select organization.offline_recovery_window_hours into selected_window
  from app_identity.organization organization
  where organization.id = candidate_organization_id;

  return query
  with inserted as (
    insert into offline_recovery.report_key_envelope
      (report_id, organization_id, owner_user_id, recovery_handle,
       wrapping_key_version, wrapping_nonce, wrapped_data_key, recovery_deadline)
    values
      (candidate_report_id, candidate_organization_id, candidate_owner_user_id,
       candidate_recovery_handle, candidate_wrapping_key_version,
       candidate_wrapping_nonce, candidate_wrapped_data_key,
       now() + make_interval(hours => selected_window))
    on conflict (report_id) do nothing
    returning report_key_envelope.recovery_handle,
      report_key_envelope.recovery_deadline,
      report_key_envelope.wrapping_key_version
  )
  select inserted.recovery_handle, inserted.recovery_deadline,
    inserted.wrapping_key_version, true
  from inserted
  union all
  select existing.recovery_handle, existing.recovery_deadline,
    existing.wrapping_key_version, false
  from offline_recovery.report_key_envelope existing
  where existing.report_id = candidate_report_id
    and not exists (select 1 from inserted);
end;
$$;

revoke all on function offline_recovery.register_report_key(
  uuid, uuid, uuid, uuid, integer, bytea, bytea
) from public;
grant usage on schema offline_recovery to open_triage_offline_runtime;
grant execute on function offline_recovery.register_report_key(
  uuid, uuid, uuid, uuid, integer, bytea, bytea
) to open_triage_offline_runtime;
