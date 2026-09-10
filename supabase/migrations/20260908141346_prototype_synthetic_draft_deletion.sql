-- The prototype UI may discard only one explicitly selected synthetic draft.
-- The transaction-local report id lets existing append-only triggers distinguish
-- that narrow operation from ordinary or signed clinical-data deletion.
create or replace function public.prevent_update_or_delete()
returns trigger
language plpgsql
as $$
declare
  candidate_report_id uuid;
begin
  if tg_op = 'DELETE' and tg_table_schema in ('clinical', 'clinical_audit') then
    candidate_report_id := retention.report_id_for_deleted_row(tg_table_schema, tg_table_name, to_jsonb(old));
    if retention.deletion_is_authorized(candidate_report_id) or (
      candidate_report_id::text = current_setting('open_triage.prototype_delete_report', true)
      and exists (
        select 1 from clinical.report
        where id = candidate_report_id and status = 'draft' and synthetic
      )
    ) then
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
    if retention.deletion_is_authorized(parent_report_id) or (
      parent_report_id::text = current_setting('open_triage.prototype_delete_report', true)
      and exists (
        select 1 from clinical.report
        where id = parent_report_id and status = 'draft' and synthetic
      )
    ) then
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
