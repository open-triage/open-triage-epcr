-- Restore protected ciphertext synchronization after the completion/purge
-- reconciliation migration replaced the checkpoint function with an
-- unqualified output-column reference.
create or replace function offline_recovery.checkpoint_report_ciphertext(
  candidate_report_id uuid, candidate_organization_id uuid,
  candidate_owner_user_id uuid, candidate_recovery_handle uuid,
  candidate_ciphertext_revision bigint, candidate_ciphertext_sha256 text
)
returns table (ciphertext_revision bigint, ciphertext_sha256 text)
language plpgsql security definer set search_path = '' as $$
declare current_envelope offline_recovery.report_key_envelope%rowtype;
begin
  if candidate_ciphertext_revision < 1 or candidate_ciphertext_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid protected ciphertext checkpoint' using errcode = '22023';
  end if;
  if exists (
    select 1 from offline_recovery.report_purge_tombstone tombstone
    where tombstone.report_id = candidate_report_id
  ) then return; end if;
  select * into current_envelope from offline_recovery.report_key_envelope envelope
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_owner_user_id
    and envelope.recovery_handle = candidate_recovery_handle
    and envelope.state = 'live' and envelope.recovery_deadline > now()
  for update;
  if not found then return; end if;
  if candidate_ciphertext_revision < current_envelope.synchronized_revision then
    raise exception 'protected ciphertext rollback rejected' using errcode = '40001';
  end if;
  if candidate_ciphertext_revision = current_envelope.ciphertext_revision
     and current_envelope.ciphertext_sha256 is distinct from candidate_ciphertext_sha256 then
    raise exception 'protected ciphertext revision hash mismatch' using errcode = '23505';
  end if;
  update offline_recovery.report_key_envelope envelope
  set ciphertext_revision = greatest(envelope.ciphertext_revision, candidate_ciphertext_revision),
      synchronized_revision = candidate_ciphertext_revision,
      ciphertext_sha256 = candidate_ciphertext_sha256,
      updated_at = now()
  where envelope.report_id = candidate_report_id;
  return query select candidate_ciphertext_revision, candidate_ciphertext_sha256;
end;
$$;

-- The API runtime intentionally cannot execute retention authorization
-- helpers. Check the transaction-scoped demo and purge authorities first so
-- their authorized deletes short-circuit before the restricted retention
-- predicate is evaluated.
create or replace function public.prevent_update_or_delete()
returns trigger
language plpgsql
as $$
declare
  candidate_report_id uuid;
begin
  if tg_op = 'DELETE' and tg_table_schema in ('clinical', 'clinical_audit') then
    candidate_report_id := retention.report_id_for_deleted_row(
      tg_table_schema, tg_table_name, to_jsonb(old)
    );
    if candidate_report_id::text = current_setting('open_triage.prototype_delete_report', true)
      and exists (select 1 from clinical.report
        where id = candidate_report_id and status = 'draft' and synthetic) then
      return old;
    end if;
    if candidate_report_id::text = current_setting('open_triage.synthetic_purge_report', true)
      and exists (select 1 from clinical_audit.synthetic_purge_tombstone
        where record_type = 'report' and record_id = candidate_report_id) then
      return old;
    end if;
    if tg_table_schema = 'clinical' and tg_table_name = 'dispatch_receipt'
        and (to_jsonb(old)->>'id') = current_setting('open_triage.synthetic_purge_receipt', true)
        and (
          exists (select 1 from clinical_audit.synthetic_purge_tombstone
            where record_type = 'report'
              and record_id::text = current_setting('open_triage.synthetic_purge_report', true))
          or exists (select 1 from clinical_audit.synthetic_purge_tombstone
            where record_type = 'assignment'
              and record_id::text = current_setting('open_triage.synthetic_purge_assignment', true))
        ) then
      return old;
    end if;
    if tg_table_schema = 'clinical_audit' and tg_table_name = 'synthetic_generation_event'
        and (to_jsonb(old)->>'assignment_id') = current_setting('open_triage.synthetic_purge_assignment', true)
        and exists (select 1 from clinical_audit.synthetic_purge_tombstone
          where record_type = 'assignment' and record_id = (to_jsonb(old)->>'assignment_id')::uuid) then
      return old;
    end if;
    if retention.deletion_is_authorized(candidate_report_id) then
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
    if parent_report_id::text = current_setting('open_triage.prototype_delete_report', true)
      and exists (select 1 from clinical.report
        where id = parent_report_id and status = 'draft' and synthetic) then
      return old;
    end if;
    if parent_report_id::text = current_setting('open_triage.synthetic_purge_report', true)
      and exists (select 1 from clinical_audit.synthetic_purge_tombstone
        where record_type = 'report' and record_id = parent_report_id) then
      return old;
    end if;
    if retention.deletion_is_authorized(parent_report_id) then
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

-- This helper only maps the row already visible to the API to its parent
-- report. The retention authorization predicate remains unavailable.
grant execute on function retention.report_id_for_deleted_row(text, text, jsonb)
  to open_triage_api_runtime;
