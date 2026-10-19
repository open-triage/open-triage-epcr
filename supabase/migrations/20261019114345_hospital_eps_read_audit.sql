set local lock_timeout = '5s';
alter table clinical_audit.patient_access_event drop constraint patient_access_event_action_check;
alter table clinical_audit.patient_access_event add constraint patient_access_event_action_check check (action in (
  'report.read', 'report.reopen', 'report.active', 'report.list', 'assignment.open',
  'review.report', 'review.overdue', 'photo.read', 'audio.read',
  'analytics.query', 'analytics.export.aggregate', 'analytics.export.records', 'audit.clinical-values', 'eps.read'
));

alter table clinical_audit.patient_access_event add column integration_provenance jsonb;
alter table clinical_audit.patient_access_event add constraint patient_access_eps_provenance_check check (
  (action = 'eps.read' and integration_provenance is not null and jsonb_typeof(integration_provenance) = 'object'
    and integration_provenance ?& array['configurationRevision','mappingId','mappingRevision','mappingSha256'])
  or (action <> 'eps.read' and integration_provenance is null)
);
grant insert (integration_provenance) on clinical_audit.patient_access_event to open_triage_api_runtime;
comment on column clinical_audit.patient_access_event.integration_provenance is
  'Immutable EPS configuration and canonical mapping revision. No patient identifiers or clinical payloads.';
