-- Review history follows the existing synthetic report expiry policy. The
-- append-only guard still authorizes every deletion through its report tombstone.
create or replace function retention.report_id_for_deleted_row(schema_name text, table_name text, row_data jsonb)
returns uuid language plpgsql stable security definer
set search_path = pg_catalog, retention, clinical
as $$
begin
  if schema_name = 'clinical' and table_name = 'amendment_change' then
    return (select report_id from clinical.amendment where id = (row_data->>'amendment_id')::uuid);
  end if;
  if schema_name = 'clinical' and table_name in ('review_item_evidence', 'review_assignment_history',
      'review_progress_history', 'review_overdue_history', 'review_amendment_decision', 'review_comment') then
    return (select report_id from clinical.review_item where id = (row_data->>'item_id')::uuid);
  end if;
  return coalesce((row_data->>'report_id')::uuid,
    case when schema_name = 'clinical' and table_name = 'report' then (row_data->>'id')::uuid end);
end;
$$;

-- Called only by the existing SECURITY DEFINER purge function. No new runtime
-- privilege is granted, and the locked parent must already have a purge tombstone.
create function retention.delete_expired_report_review(candidate_report_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from clinical.report r
    join clinical_audit.synthetic_purge_tombstone t on t.record_id=r.id and t.record_type='report'
    where r.id=candidate_report_id and r.synthetic and r.synthetic_generated_by is not null
      and r.expires_at<=t.purged_at
      and r.id::text=current_setting('open_triage.synthetic_purge_report',true)) then
    raise exception 'Review cleanup requires an authorized synthetic report purge';
  end if;
  delete from clinical.review_retrospective_report where report_id=candidate_report_id;
  delete from clinical.review_comment where item_id in (select id from clinical.review_item where report_id=candidate_report_id);
  delete from clinical.review_amendment_decision where item_id in (select id from clinical.review_item where report_id=candidate_report_id);
  delete from clinical.review_progress_history where item_id in (select id from clinical.review_item where report_id=candidate_report_id);
  delete from clinical.review_overdue_history where item_id in (select id from clinical.review_item where report_id=candidate_report_id);
  delete from clinical.review_assignment_history where item_id in (select id from clinical.review_item where report_id=candidate_report_id);
  delete from clinical.review_item_evidence where item_id in (select id from clinical.review_item where report_id=candidate_report_id);
  delete from clinical.review_item where report_id=candidate_report_id;
  delete from clinical.review_evaluation where report_id=candidate_report_id;
  delete from clinical.review_work where report_id=candidate_report_id;
end;
$$;
revoke all on function retention.delete_expired_report_review(uuid) from public;

do $$
declare definition text; anchor text := 'delete from clinical.signed_snapshot where report_id = selected_report.id;';
begin
  select pg_get_functiondef('retention.purge_expired_synthetic_records(timestamp with time zone)'::regprocedure) into definition;
  if strpos(definition, anchor)=0 then raise exception 'Synthetic purge integration point was not found'; end if;
  execute replace(definition, anchor,
    'perform retention.delete_expired_report_review(selected_report.id);' || chr(10) || '    ' || anchor);
end;
$$;
