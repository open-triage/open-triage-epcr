-- API-only endpoint source from the existing effective signed report projection.
-- Timestamptz values are instants: offset conversion is already performed by
-- the projector, and this view never changes the documented source values.
create view analytics.review_operational_time_source with (security_barrier = true) as
select report_id, organization_id, documenting_user_id, synthetic, reporting_date,
  etimes_03, etimes_06, etimes_09, etimes_11,
  coalesce(element_statuses ? 'eTimes.03', false) as etimes_03_absent,
  coalesce(element_statuses ? 'eTimes.06', false) as etimes_06_absent,
  coalesce(element_statuses ? 'eTimes.09', false) as etimes_09_absent,
  coalesce(element_statuses ? 'eTimes.11', false) as etimes_11_absent
from analytics_private.epcr;

revoke all on analytics.review_operational_time_source from public, open_triage_analyst, open_triage_identified_analyst;

-- Supabase roles are optional on standalone PostgreSQL installations.
do $$
declare optional_role text;
begin
  foreach optional_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = optional_role) then
      execute format('revoke all on analytics.review_operational_time_source from %I', optional_role);
    end if;
  end loop;
end;
$$;
grant select on analytics.review_operational_time_source to open_triage_api_runtime;
comment on view analytics.review_operational_time_source is
  'API-only operational time endpoints from the effective signed patient-report projection.';
