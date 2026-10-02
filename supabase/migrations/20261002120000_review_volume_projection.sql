-- Stable scope fields are copied from the effective signed report into the
-- private projection. Existing partitions are populated before enforcement.
alter table analytics_private.epcr add column documenting_user_id uuid;
alter table analytics_private.epcr add column synthetic boolean;

update analytics_private.epcr projected
set documenting_user_id = source.documenting_user_id,
    synthetic = source.synthetic
from clinical.report source
where source.id = projected.report_id;

alter table analytics_private.epcr alter column documenting_user_id set not null;
alter table analytics_private.epcr alter column synthetic set not null;

create index epcr_review_volume_scope_idx on analytics_private.epcr
  (organization_id, synthetic, documenting_user_id, reporting_date);

-- This narrow view is an API-only aggregate input. The analyst views and
-- private wide projection retain their existing, separate privilege model.
create view analytics.review_volume_source with (security_barrier = true) as
select organization_id, documenting_user_id, synthetic, reporting_date,
  report_id, projected_at
from analytics_private.epcr;

revoke all on analytics.review_volume_source from public, anon, authenticated,
  open_triage_analyst, open_triage_identified_analyst;
grant usage on schema analytics, operations to open_triage_api_runtime;
grant select on analytics.review_volume_source,
  operations.projection_health, operations.reporting_replica_health
  to open_triage_api_runtime;

comment on view analytics.review_volume_source is
  'API-only signed patient-report count source; scope fields are projection metadata.';
