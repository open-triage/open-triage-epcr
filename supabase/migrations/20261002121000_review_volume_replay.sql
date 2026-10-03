-- Queue every signed report whose analytical row predates the scope metadata
-- projector version, including reports never projected by an earlier worker.
-- The ordinary idempotent projector resolves effective amendment lineage.
insert into integration.outbox_event (aggregate_type, aggregate_id, event_type, payload)
select 'report', report.id, 'review-volume-replay', '{}'::jsonb
from clinical.report report
where report.status = 'signed'
  and not exists (
    select 1 from analytics_private.epcr projected
    where projected.report_id = report.id
      and projected.projector_version = '1.1.0'
  );
