-- Preserve the truthful provenance of records completed before Validation
-- versioning. Null version foreign keys remain the machine-readable boundary;
-- these flags make that boundary explicit to operators and auditors.

alter table clinical.report
  add column legacy_unversioned_validation boolean not null default false;

alter table clinical.signed_snapshot
  add column legacy_unversioned_validation boolean not null default false;

alter table clinical.validation_finding
  add column legacy_unversioned_validation boolean not null default false;

alter table clinical.report disable trigger report_signed_immutable;
alter table clinical.signed_snapshot disable trigger signed_snapshot_append_only;

update clinical.report report
set legacy_unversioned_validation = true
where report.validation_version_id is null
  and exists (select 1 from clinical.signed_snapshot snapshot where snapshot.report_id = report.id);

update clinical.signed_snapshot snapshot
set legacy_unversioned_validation = true
where snapshot.validation_version_id is null;

update clinical.validation_finding finding
set legacy_unversioned_validation = true
where finding.validation_version_id is null
  and exists (select 1 from clinical.signed_snapshot snapshot where snapshot.report_id = finding.report_id);

alter table clinical.report enable trigger report_signed_immutable;
alter table clinical.signed_snapshot enable trigger signed_snapshot_append_only;

alter table clinical.report
  add constraint report_legacy_validation_truth_check check (
    not legacy_unversioned_validation or validation_version_id is null
  );

alter table clinical.signed_snapshot
  add constraint signed_snapshot_legacy_validation_truth_check check (
    legacy_unversioned_validation = (validation_version_id is null)
  );

alter table clinical.validation_finding
  add constraint finding_legacy_validation_truth_check check (
    not legacy_unversioned_validation
    or (validation_version_id is null and validation_rule_id is null)
  );

create function clinical.mark_signed_legacy_validation()
returns trigger language plpgsql as $$
begin
  if new.status = 'signed' and new.validation_version_id is null then
    new.legacy_unversioned_validation := true;
  end if;
  return new;
end;
$$;

create trigger report_mark_signed_legacy_validation
before insert or update of status on clinical.report
for each row execute function clinical.mark_signed_legacy_validation();

create function clinical.mark_snapshot_legacy_validation()
returns trigger language plpgsql as $$
begin
  new.legacy_unversioned_validation := new.validation_version_id is null;
  return new;
end;
$$;

create trigger snapshot_mark_legacy_validation
before insert on clinical.signed_snapshot
for each row execute function clinical.mark_snapshot_legacy_validation();

comment on column clinical.report.legacy_unversioned_validation is
  'True only when the signed report predates a pinned Validation version.';
comment on column clinical.signed_snapshot.legacy_unversioned_validation is
  'True when the immutable signature, including warning_acknowledgements, was created without a Validation version.';
comment on column clinical.validation_finding.legacy_unversioned_validation is
  'True for a preserved finding from a signed, unversioned legacy report.';

-- The rollout reset is deliberately unavailable to application workloads. The
-- migration credential may assume this marker role only for the short-lived,
-- operator-confirmed command.
do $$
begin
  execute format('grant open_triage_migration_executor to %I', session_user);
end;
$$;

create function clinical.unsigned_rollout_deletion_is_authorized(candidate_report_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select candidate_report_id is not null
    and candidate_report_id::text = current_setting('open_triage.unsigned_rollout_report', true)
    and pg_has_role(session_user, 'open_triage_migration_executor', 'member')
    and exists (select 1 from clinical.report
      where id = candidate_report_id and status = 'draft')
    and not exists (select 1 from clinical.signed_snapshot
      where report_id = candidate_report_id)
$$;

revoke all on function clinical.unsigned_rollout_deletion_is_authorized(uuid) from public;

create or replace function public.prevent_update_or_delete()
returns trigger language plpgsql as $$
declare candidate_report_id uuid;
begin
  if tg_op = 'DELETE' and tg_table_schema in ('clinical', 'clinical_audit') then
    candidate_report_id := retention.report_id_for_deleted_row(tg_table_schema, tg_table_name, to_jsonb(old));
    if clinical.unsigned_rollout_deletion_is_authorized(candidate_report_id) then return old; end if;
    if candidate_report_id::text = current_setting('open_triage.prototype_delete_report', true)
      and exists (select 1 from clinical.report where id=candidate_report_id and status='draft' and synthetic)
      then return old; end if;
    if candidate_report_id::text = current_setting('open_triage.synthetic_purge_report', true)
      and exists (select 1 from clinical_audit.synthetic_purge_tombstone
        where record_type='report' and record_id=candidate_report_id) then return old; end if;
    if tg_table_schema='clinical' and tg_table_name='dispatch_receipt'
      and (to_jsonb(old)->>'id')=current_setting('open_triage.synthetic_purge_receipt', true)
      and (exists (select 1 from clinical_audit.synthetic_purge_tombstone where record_type='report'
          and record_id::text=current_setting('open_triage.synthetic_purge_report', true))
        or exists (select 1 from clinical_audit.synthetic_purge_tombstone where record_type='assignment'
          and record_id::text=current_setting('open_triage.synthetic_purge_assignment', true))) then return old; end if;
    if tg_table_schema='clinical_audit' and tg_table_name='synthetic_generation_event'
      and (to_jsonb(old)->>'assignment_id')=current_setting('open_triage.synthetic_purge_assignment', true)
      and exists (select 1 from clinical_audit.synthetic_purge_tombstone where record_type='assignment'
        and record_id=(to_jsonb(old)->>'assignment_id')::uuid) then return old; end if;
    if retention.deletion_is_authorized(candidate_report_id) then return old; end if;
  end if;
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name;
end;
$$;

create or replace function clinical.prevent_signed_report_mutation()
returns trigger language plpgsql as $$
declare parent_report_id uuid; parent_status text;
begin
  if tg_op='DELETE' then
    parent_report_id := coalesce((to_jsonb(old)->>'report_id')::uuid,
      case when tg_table_name='report' then (to_jsonb(old)->>'id')::uuid end);
    if clinical.unsigned_rollout_deletion_is_authorized(parent_report_id) then return old; end if;
    if parent_report_id::text=current_setting('open_triage.prototype_delete_report', true)
      and exists (select 1 from clinical.report where id=parent_report_id and status='draft' and synthetic)
      then return old; end if;
    if parent_report_id::text=current_setting('open_triage.synthetic_purge_report', true)
      and exists (select 1 from clinical_audit.synthetic_purge_tombstone
        where record_type='report' and record_id=parent_report_id) then return old; end if;
    if retention.deletion_is_authorized(parent_report_id) then return old; end if;
  end if;
  if tg_table_name='report' then
    if old.status='signed' then raise exception 'signed report % is immutable; create an amendment', old.id; end if;
    if tg_op='DELETE' and exists (select 1 from clinical.signed_snapshot where report_id=old.id)
      then raise exception 'signed report % cannot be deleted', old.id; end if;
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  parent_report_id := case when tg_op='DELETE' then old.report_id else new.report_id end;
  select status into parent_status from clinical.report where id=parent_report_id;
  if parent_status='signed' then raise exception 'content of signed report % is immutable; create an amendment', parent_report_id; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;

create function clinical.reset_unsigned_rollout(candidate_report_ids uuid[], candidate_assignment_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare selected_report record; deleted_reports integer := 0; deleted_assignments integer := 0; affected integer := 0;
begin
  if not pg_has_role(session_user, 'open_triage_migration_executor', 'member') then
    raise exception 'unsigned rollout reset requires the migration executor';
  end if;
  if exists (select 1 from unnest(candidate_report_ids) requested(id)
    left join clinical.report report on report.id=requested.id
    where report.id is null or report.status <> 'draft'
      or exists (select 1 from clinical.signed_snapshot snapshot where snapshot.report_id=requested.id)) then
    raise exception 'reset boundary contains a missing or signed report';
  end if;
  if exists (select 1 from unnest(candidate_assignment_ids) requested(id)
    left join clinical.call_assignment assignment on assignment.id=requested.id
    left join clinical.report report on report.id=assignment.report_id
    where assignment.id is null or report.status='signed'
      or exists (select 1 from clinical.signed_snapshot snapshot where snapshot.report_id=assignment.report_id)) then
    raise exception 'reset boundary contains a missing or signed call';
  end if;
  perform 1 from clinical.report where id=any(candidate_report_ids) for update;
  perform 1 from clinical.call_assignment where id=any(candidate_assignment_ids) for update;
  for selected_report in select id,incident_id,patient_id from clinical.report
    where id=any(candidate_report_ids) order by id
  loop
    perform set_config('open_triage.unsigned_rollout_report', selected_report.id::text, true);
    delete from analytics_private.epcr_repeatable_element where report_id=selected_report.id;
    delete from analytics_private.epcr where report_id=selected_report.id;
    delete from integration.projection_backfill_job where report_id=selected_report.id;
    delete from integration.outbox_event where aggregate_type='report' and aggregate_id=selected_report.id;
    delete from clinical_audit.draft_reconciliation where report_id=selected_report.id;
    delete from clinical_audit.event where report_id=selected_report.id;
    delete from clinical.draft_target_state where report_id=selected_report.id;
    delete from clinical.dispatch_conflict where report_id=selected_report.id;
    delete from clinical.validation_finding where report_id=selected_report.id;
    delete from clinical.element_occurrence where report_id=selected_report.id;
    delete from clinical.group_instance where report_id=selected_report.id;
    delete from clinical.report_contributor where report_id=selected_report.id;
    delete from clinical.command_receipt where report_id=selected_report.id;
    delete from clinical.report_change where report_id=selected_report.id;
    delete from clinical.call_assignment where report_id=selected_report.id;
    get diagnostics affected = row_count;
    deleted_assignments := deleted_assignments + affected;
    delete from clinical.report where id=selected_report.id;
    deleted_reports := deleted_reports + 1;
    delete from clinical.patient where id=selected_report.patient_id
      and not exists (select 1 from clinical.report where patient_id=selected_report.patient_id);
    delete from clinical.incident where id=selected_report.incident_id
      and not exists (select 1 from clinical.report where incident_id=selected_report.incident_id)
      and not exists (select 1 from clinical.call_assignment where incident_id=selected_report.incident_id);
  end loop;
  delete from clinical.call_assignment where id=any(candidate_assignment_ids);
  get diagnostics affected = row_count;
  deleted_assignments := deleted_assignments + affected;
  perform set_config('open_triage.unsigned_rollout_report', '', true);
  return jsonb_build_object('reports',deleted_reports,'calls',deleted_assignments);
end;
$$;

revoke all on function clinical.reset_unsigned_rollout(uuid[], uuid[]) from public;
grant usage on schema clinical to open_triage_migration_executor;
grant execute on function clinical.reset_unsigned_rollout(uuid[], uuid[]) to open_triage_migration_executor;
