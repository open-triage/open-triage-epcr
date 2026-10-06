-- New patient reports created by Clinical Demo users have creator provenance
-- without a dispatch assignment. Keep the same immutable lifecycle and expiry.
alter table clinical.report
  drop constraint report_synthetic_expiry_provenance_check,
  add constraint report_synthetic_expiry_provenance_check check (
    (synthetic_generated_by is null and synthetic_source_assignment_id is null)
    or (synthetic and synthetic_generated_by is not null
      and (synthetic_source_assignment_id is not null
        or synthetic_generated_by = documenting_user_id)
      and (expires_at is null or expires_at > created_at))
  );

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
      if new.synthetic_source_assignment_id is null then
        if new.synthetic_generated_by is distinct from new.documenting_user_id
          or not app_identity.user_has_capability(
            new.synthetic_generated_by, new.organization_id, 'clinical:demo'
          ) then
          raise exception 'synthetic new-patient reports require their Clinical Demo creator';
        end if;
      elsif not exists (
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

