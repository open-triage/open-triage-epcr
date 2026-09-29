-- Preserve signed-report and retention guards without granting retention access to the API.
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
    -- Ordinary draft mutations do not have retention privileges. Only callers
    -- already authorized to use the retention predicate may enter that path.
    if has_function_privilege(current_user, 'retention.deletion_is_authorized(uuid)', 'EXECUTE') then
      if retention.deletion_is_authorized(parent_report_id) then return old; end if;
    end if;
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
