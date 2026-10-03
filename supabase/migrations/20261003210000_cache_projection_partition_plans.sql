-- Reuse plans for report lookups across every analytical partition. These
-- remain invoker functions; transaction poolers need no client-side prepares.
create function analytics_private.report_projection_is_current(
  target_report_id uuid,
  target_reporting_date date,
  target_snapshot_id uuid,
  target_amendment_sequence integer,
  target_projector_version text,
  expected_repeatable_count integer,
  target_documenting_user_id uuid,
  target_synthetic boolean
) returns boolean
language plpgsql
security invoker
set search_path = ''
set plan_cache_mode = force_generic_plan
as $$
begin
  return coalesce(
    (select count(*) = 1 and bool_and(
       reporting_date = target_reporting_date and signed_snapshot_id = target_snapshot_id
       and effective_amendment_sequence = target_amendment_sequence
       and projector_version = target_projector_version
       and documenting_user_id = target_documenting_user_id and synthetic = target_synthetic)
     from analytics_private.epcr where report_id = target_report_id)
    and
    (select count(*) = expected_repeatable_count and coalesce(bool_and(
       reporting_date = target_reporting_date and signed_snapshot_id = target_snapshot_id
       and effective_amendment_sequence = target_amendment_sequence
       and projector_version = target_projector_version), true)
     from analytics_private.epcr_repeatable_element where report_id = target_report_id),
    false
  );
end;
$$;

create function analytics_private.delete_report_projection(target_report_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
set plan_cache_mode = force_generic_plan
as $$
begin
  -- Include every partition so date corrections and stray projections are
  -- removed together within the caller's existing report transaction.
  delete from analytics_private.epcr_repeatable_element where report_id = target_report_id;
  delete from analytics_private.epcr where report_id = target_report_id;
end;
$$;

revoke all on function analytics_private.report_projection_is_current(
  uuid, date, uuid, integer, text, integer, uuid, boolean
) from public;
revoke all on function analytics_private.delete_report_projection(uuid) from public;
grant execute on function analytics_private.report_projection_is_current(
  uuid, date, uuid, integer, text, integer, uuid, boolean
) to open_triage_projector;
grant execute on function analytics_private.delete_report_projection(uuid) to open_triage_projector;
