-- A null agency policy disables automatic expiry for newly generated demo data.
-- Existing records retain their immutable creation-time deadlines.
alter table app_identity.agency_settings
  add column synthetic_retention_hours bigint default 24
    check (synthetic_retention_hours > 0);

comment on column app_identity.agency_settings.synthetic_retention_hours is
  'Positive whole hours after server creation for new generated calls/reports; NULL disables automatic expiry. No product maximum.';

alter table app_identity.agency_settings_change_event
  add column old_synthetic_retention_hours bigint default 24
    check (old_synthetic_retention_hours > 0),
  add column new_synthetic_retention_hours bigint default 24
    check (new_synthetic_retention_hours > 0);

alter table clinical.call_assignment
  drop constraint call_assignment_synthetic_expiry_check,
  add constraint call_assignment_synthetic_expiry_check check (
    (synthetic_generated_by is null and expires_at is null)
    or (synthetic and synthetic_generated_by is not null
      and (expires_at is null or expires_at > created_at))
  );

alter table clinical.report
  drop constraint report_synthetic_expiry_provenance_check,
  add constraint report_synthetic_expiry_provenance_check check (
    (synthetic_generated_by is null and synthetic_source_assignment_id is null)
    or (synthetic and synthetic_generated_by is not null
      and synthetic_source_assignment_id is not null
      and (expires_at is null or expires_at > created_at))
  );

alter table clinical_audit.synthetic_purge_tombstone
  drop constraint synthetic_purge_tombstone_check,
  add constraint synthetic_purge_tombstone_expiry_check
    check (expired_at > server_created_at);

create or replace function clinical.prepare_synthetic_lifecycle()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  retention_hours bigint;
begin
  if tg_table_name = 'call_assignment' then
    if tg_op = 'UPDATE'
      and (old.synthetic_generated_by is not null or new.synthetic_generated_by is not null)
      and (
      new.synthetic_generated_by is distinct from old.synthetic_generated_by
      or new.created_at is distinct from old.created_at
      or new.expires_at is distinct from old.expires_at
    ) then
      raise exception 'synthetic assignment provenance and expiry are immutable';
    end if;
    if tg_op = 'INSERT' and new.synthetic_generated_by is not null then
      select settings.synthetic_retention_hours into retention_hours
      from app_identity.agency_settings settings
      where settings.organization_id = new.organization_id;
      if not found then retention_hours := 24; end if;
      new.expires_at := new.created_at + retention_hours * interval '1 hour';
    end if;
  else
    if tg_op = 'INSERT' and exists (
      select 1 from clinical_audit.synthetic_purge_tombstone
      where record_type = 'report' and record_id = new.id
    ) then
      raise exception 'purged report % can never be recreated', new.id using errcode = '23505';
    end if;
    if tg_op = 'UPDATE'
      and (old.synthetic_generated_by is not null or new.synthetic_generated_by is not null)
      and (
      new.synthetic_generated_by is distinct from old.synthetic_generated_by
      or new.synthetic_source_assignment_id is distinct from old.synthetic_source_assignment_id
      or new.created_at is distinct from old.created_at
      or new.expires_at is distinct from old.expires_at
    ) then
      raise exception 'synthetic report provenance and expiry are immutable';
    end if;
    if tg_op = 'INSERT' and new.synthetic_generated_by is not null then
      if not exists (
        select 1 from clinical.call_assignment assignment
        where assignment.id = new.synthetic_source_assignment_id
          and assignment.organization_id = new.organization_id
          and assignment.synthetic_generated_by = new.synthetic_generated_by
          and assignment.synthetic
      ) then
        raise exception 'synthetic report provenance must reference its generated assignment';
      end if;
      select settings.synthetic_retention_hours into retention_hours
      from app_identity.agency_settings settings
      where settings.organization_id = new.organization_id;
      if not found then retention_hours := 24; end if;
      new.expires_at := new.created_at + retention_hours * interval '1 hour';
    end if;
  end if;
  return new;
end;
$$;

