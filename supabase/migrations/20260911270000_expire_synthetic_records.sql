-- Generated Clinical Demo records are disposable server-owned data. Their
-- provenance and deadlines are assigned by the database and cannot be extended.
alter table clinical.call_assignment
  add column expires_at timestamptz;

alter table clinical.report
  add column synthetic_generated_by uuid,
  add column synthetic_source_assignment_id uuid;

alter table clinical.call_assignment
  add constraint call_assignment_synthetic_expiry_check check (
    (synthetic_generated_by is null and expires_at is null)
    or (synthetic and synthetic_generated_by is not null
      and expires_at = created_at + interval '24 hours')
  );

alter table clinical.report
  add constraint report_synthetic_expiry_provenance_check check (
    (synthetic_generated_by is null and synthetic_source_assignment_id is null)
    or (synthetic and synthetic_generated_by is not null
      and synthetic_source_assignment_id is not null
      and expires_at = created_at + interval '24 hours')
  );

create index call_assignment_synthetic_expiry_idx
  on clinical.call_assignment (expires_at, id)
  where synthetic_generated_by is not null;

create index report_synthetic_expiry_idx
  on clinical.report (expires_at, id)
  where synthetic_generated_by is not null;

-- This is both the minimal non-PHI purge audit and the permanent anti-replay
-- tombstone. Record identifiers and lifecycle timestamps are deliberately the
-- only record-level facts retained.
create table clinical_audit.synthetic_purge_tombstone (
  record_type text not null check (record_type in ('assignment', 'report')),
  record_id uuid not null,
  organization_id uuid not null references app_identity.organization(id),
  server_created_at timestamptz not null,
  expired_at timestamptz not null,
  purged_at timestamptz not null default clock_timestamp(),
  primary key (record_type, record_id),
  check (expired_at = server_created_at + interval '24 hours'),
  check (purged_at >= expired_at)
);

create index synthetic_purge_tombstone_organization_time_idx
  on clinical_audit.synthetic_purge_tombstone (organization_id, purged_at desc);

create trigger synthetic_purge_tombstone_append_only
before update or delete on clinical_audit.synthetic_purge_tombstone
for each row execute function public.prevent_update_or_delete();

revoke all on clinical_audit.synthetic_purge_tombstone from public;

create function clinical.prepare_synthetic_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, clinical, clinical_audit
as $$
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
      new.expires_at := new.created_at + interval '24 hours';
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
      new.expires_at := new.created_at + interval '24 hours';
    end if;
  end if;
  return new;
end;
$$;

create trigger call_assignment_synthetic_lifecycle
before insert or update of synthetic_generated_by, created_at, expires_at
on clinical.call_assignment
for each row execute function clinical.prepare_synthetic_lifecycle();

create trigger report_synthetic_lifecycle
before insert or update of synthetic_generated_by, synthetic_source_assignment_id, created_at, expires_at
on clinical.report
for each row execute function clinical.prepare_synthetic_lifecycle();

revoke all on function clinical.prepare_synthetic_lifecycle() from public;

-- Extend the existing narrow deletion authorization so append-only clinical
-- rows can be removed only while the purge function holds their parent report.
create or replace function public.prevent_update_or_delete()
returns trigger
language plpgsql
as $$
declare
  candidate_report_id uuid;
begin
  if tg_op = 'DELETE' and tg_table_schema in ('clinical', 'clinical_audit') then
    candidate_report_id := retention.report_id_for_deleted_row(tg_table_schema, tg_table_name, to_jsonb(old));
    if retention.deletion_is_authorized(candidate_report_id)
      or (candidate_report_id::text = current_setting('open_triage.prototype_delete_report', true)
        and exists (select 1 from clinical.report
          where id = candidate_report_id and status = 'draft' and synthetic))
      or (candidate_report_id::text = current_setting('open_triage.synthetic_purge_report', true)
        and exists (select 1 from clinical_audit.synthetic_purge_tombstone
          where record_type = 'report' and record_id = candidate_report_id))
      or (tg_table_schema = 'clinical' and tg_table_name = 'dispatch_receipt'
        and (to_jsonb(old)->>'id') = current_setting('open_triage.synthetic_purge_receipt', true)
        and (
          exists (select 1 from clinical_audit.synthetic_purge_tombstone
            where record_type = 'report'
              and record_id::text = current_setting('open_triage.synthetic_purge_report', true))
          or exists (select 1 from clinical_audit.synthetic_purge_tombstone
            where record_type = 'assignment'
              and record_id::text = current_setting('open_triage.synthetic_purge_assignment', true))
        ))
      or (tg_table_schema = 'clinical_audit' and tg_table_name = 'synthetic_generation_event'
        and (to_jsonb(old)->>'assignment_id') = current_setting('open_triage.synthetic_purge_assignment', true)
        and exists (select 1 from clinical_audit.synthetic_purge_tombstone
          where record_type = 'assignment' and record_id = (to_jsonb(old)->>'assignment_id')::uuid)) then
      return old;
    end if;
  end if;
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name;
end;
$$;

create or replace function clinical.prevent_signed_report_mutation()
returns trigger
language plpgsql
as $$
declare
  parent_report_id uuid;
  parent_status text;
begin
  if tg_op = 'DELETE' then
    parent_report_id := coalesce((to_jsonb(old)->>'report_id')::uuid,
      case when tg_table_name = 'report' then (to_jsonb(old)->>'id')::uuid end);
    if retention.deletion_is_authorized(parent_report_id)
      or (parent_report_id::text = current_setting('open_triage.prototype_delete_report', true)
        and exists (select 1 from clinical.report
          where id = parent_report_id and status = 'draft' and synthetic))
      or (parent_report_id::text = current_setting('open_triage.synthetic_purge_report', true)
        and exists (select 1 from clinical_audit.synthetic_purge_tombstone
          where record_type = 'report' and record_id = parent_report_id)) then
      return old;
    end if;
  end if;
  if tg_table_name = 'report' then
    if old.status = 'signed' then
      raise exception 'signed report % is immutable; create an amendment', old.id;
    end if;
    if tg_op = 'DELETE' and exists (select 1 from clinical.signed_snapshot where report_id = old.id) then
      raise exception 'signed report % cannot be deleted', old.id;
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  parent_report_id := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  select status into parent_status from clinical.report where id = parent_report_id;
  if parent_status = 'signed' then
    raise exception 'content of signed report % is immutable; create an amendment', parent_report_id;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create function retention.purge_expired_synthetic_records(
  candidate_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, retention, clinical, clinical_audit, integration, analytics_private
as $$
declare
  selected_assignment record;
  selected_report record;
  selected_receipt_id uuid;
  selected_receipt_ids uuid[];
  purged_assignments integer := 0;
  purged_reports integer := 0;
begin
  if candidate_now is null then raise exception 'purge time is required'; end if;

  -- A stable order and SKIP LOCKED let concurrent workers divide ready records
  -- without blocking one another or double-writing tombstones.
  for selected_assignment in
    select ca.id, ca.organization_id, ca.incident_id, ca.dispatch_receipt_id,
           ca.created_at, ca.expires_at
    from clinical.call_assignment ca
    where ca.synthetic_generated_by is not null and ca.expires_at <= candidate_now
    order by ca.expires_at, ca.id
    for update skip locked
  loop
    insert into clinical_audit.synthetic_purge_tombstone
      (record_type, record_id, organization_id, server_created_at, expired_at, purged_at)
    values ('assignment', selected_assignment.id, selected_assignment.organization_id,
      selected_assignment.created_at, selected_assignment.expires_at, candidate_now)
    on conflict do nothing;
    perform set_config('open_triage.synthetic_purge_assignment', selected_assignment.id::text, true);
    delete from clinical_audit.synthetic_generation_event
      where assignment_id = selected_assignment.id;
    delete from clinical.call_assignment where id = selected_assignment.id;
    if selected_assignment.dispatch_receipt_id is not null and not exists (
      select 1 from clinical.call_assignment where dispatch_receipt_id = selected_assignment.dispatch_receipt_id
    ) and not exists (
      select 1 from clinical.report where dispatch_cancellation_receipt_id = selected_assignment.dispatch_receipt_id
    ) and not exists (
      select 1 from clinical.dispatch_conflict where dispatch_receipt_id = selected_assignment.dispatch_receipt_id
    ) and not exists (
      select 1 from clinical_audit.post_signature_dispatch_delivery
      where dispatch_receipt_id = selected_assignment.dispatch_receipt_id
    ) then
      perform set_config('open_triage.synthetic_purge_receipt', selected_assignment.dispatch_receipt_id::text, true);
      delete from clinical.dispatch_receipt where id = selected_assignment.dispatch_receipt_id;
    end if;
    delete from clinical.incident where id = selected_assignment.incident_id
      and not exists (select 1 from clinical.call_assignment where incident_id = selected_assignment.incident_id)
      and not exists (select 1 from clinical.report where incident_id = selected_assignment.incident_id);
    purged_assignments := purged_assignments + 1;
  end loop;

  for selected_report in
    select r.id, r.organization_id, r.incident_id, r.patient_id,
           r.created_at, r.expires_at, r.dispatch_cancellation_receipt_id
    from clinical.report r
    where r.synthetic_generated_by is not null and r.expires_at <= candidate_now
    order by r.expires_at, r.id
    for update skip locked
  loop
    insert into clinical_audit.synthetic_purge_tombstone
      (record_type, record_id, organization_id, server_created_at, expired_at, purged_at)
    values ('report', selected_report.id, selected_report.organization_id,
      selected_report.created_at, selected_report.expires_at, candidate_now)
    on conflict do nothing;
    perform set_config('open_triage.synthetic_purge_report', selected_report.id::text, true);

    select array_agg(receipt_id) into selected_receipt_ids from (
      select dispatch_receipt_id as receipt_id from clinical.dispatch_conflict
        where report_id = selected_report.id
      union
      select dispatch_receipt_id from clinical_audit.post_signature_dispatch_delivery
        where report_id = selected_report.id
      union
      select selected_report.dispatch_cancellation_receipt_id
        where selected_report.dispatch_cancellation_receipt_id is not null
    ) dependent_receipts;

    delete from analytics_private.epcr_repeatable_element where report_id = selected_report.id;
    delete from analytics_private.epcr where report_id = selected_report.id;
    delete from integration.projection_backfill_job where report_id = selected_report.id;
    delete from integration.outbox_event where aggregate_type = 'report' and aggregate_id = selected_report.id;
    delete from clinical_audit.post_signature_dispatch_delivery where report_id = selected_report.id;
    delete from clinical_audit.post_signature_audit_note where report_id = selected_report.id;
    delete from clinical_audit.draft_reconciliation where report_id = selected_report.id;
    delete from clinical_audit.event where report_id = selected_report.id;
    delete from clinical_audit.synthetic_draft_mutation_event where report_id = selected_report.id;
    delete from clinical.amendment_change where amendment_id in
      (select id from clinical.amendment where report_id = selected_report.id);
    delete from clinical.amendment where report_id = selected_report.id;
    delete from clinical.signed_snapshot where report_id = selected_report.id;
    delete from clinical.call_assignment where report_id = selected_report.id;
    delete from clinical.report where id = selected_report.id;
    delete from clinical.patient where id = selected_report.patient_id
      and not exists (select 1 from clinical.report where patient_id = selected_report.patient_id);
    delete from clinical.incident where id = selected_report.incident_id
      and not exists (select 1 from clinical.call_assignment where incident_id = selected_report.incident_id)
      and not exists (select 1 from clinical.report where incident_id = selected_report.incident_id);

    foreach selected_receipt_id in array coalesce(selected_receipt_ids, '{}'::uuid[]) loop
      if not exists (
        select 1 from clinical.call_assignment where dispatch_receipt_id = selected_receipt_id
      ) and not exists (
        select 1 from clinical.report where dispatch_cancellation_receipt_id = selected_receipt_id
      ) and not exists (
        select 1 from clinical.dispatch_conflict where dispatch_receipt_id = selected_receipt_id
      ) and not exists (
        select 1 from clinical_audit.post_signature_dispatch_delivery
          where dispatch_receipt_id = selected_receipt_id
      ) then
        perform set_config('open_triage.synthetic_purge_receipt', selected_receipt_id::text, true);
        delete from clinical.dispatch_receipt where id = selected_receipt_id;
      end if;
    end loop;
    purged_reports := purged_reports + 1;
  end loop;
  return jsonb_build_object('assignments', purged_assignments, 'reports', purged_reports);
end;
$$;

revoke all on function retention.purge_expired_synthetic_records(timestamptz) from public;
grant execute on function retention.purge_expired_synthetic_records(timestamptz)
  to open_triage_retention_executor;
