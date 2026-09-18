alter table clinical.validation_finding
  drop constraint validation_finding_severity_check,
  add constraint validation_finding_severity_check
    check (severity in ('error', 'warning', 'information')),
  add column target_group_instance_id uuid,
  add column target_occurrence_id uuid;

create index validation_finding_report_revision_idx
  on clinical.validation_finding (report_id, revision, severity);

comment on column clinical.validation_finding.acknowledged_by is
  'Actor who acknowledged this exact warning instance; null for errors, information, and unacknowledged warnings.';
comment on column clinical.validation_finding.input_fingerprint is
  'Fingerprint of the rule inputs that produced this finding. A changed fingerprint requires a new acknowledgement.';
comment on column clinical.validation_finding.target_group_instance_id is
  'Exact repeated group row targeted by the finding, when applicable.';
comment on column clinical.validation_finding.target_occurrence_id is
  'Exact element occurrence targeted by the finding, when applicable.';
