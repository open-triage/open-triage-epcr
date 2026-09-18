-- Review evaluations are immutable observations of one report revision under
-- one explicitly selected published Validation version. They deliberately do
-- not share clinical.validation_finding, which is signing state.

create table clinical.validation_review_evaluation (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null,
  report_revision bigint not null check (report_revision >= 0),
  validation_version_id uuid not null,
  validation_compiled_sha256 text not null
    check (validation_compiled_sha256 ~ '^[a-f0-9]{64}$'),
  evaluated_by uuid not null,
  outcome text not null check (outcome in ('passed', 'findings', 'failed')),
  findings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(findings) = 'array'),
  failures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(failures) = 'array'),
  evaluated_at timestamptz not null,
  foreign key (organization_id, report_id)
    references clinical.report(organization_id, id),
  foreign key (organization_id, validation_version_id)
    references validation.version(organization_id, id),
  foreign key (organization_id, evaluated_by)
    references app_identity.app_user(organization_id, id),
  check (
    (outcome = 'failed' and jsonb_array_length(failures) > 0)
    or (outcome = 'findings' and jsonb_array_length(failures) = 0
      and jsonb_array_length(findings) > 0)
    or (outcome = 'passed' and jsonb_array_length(failures) = 0
      and jsonb_array_length(findings) = 0)
  )
);

create index validation_review_evaluation_report_time_idx
  on clinical.validation_review_evaluation
  (organization_id, report_id, evaluated_at desc, id desc);
create index validation_review_evaluation_version_idx
  on clinical.validation_review_evaluation (validation_version_id);
create index validation_review_evaluation_actor_time_idx
  on clinical.validation_review_evaluation (evaluated_by, evaluated_at desc);

create trigger validation_review_evaluation_append_only
before update or delete on clinical.validation_review_evaluation
for each row execute function public.prevent_update_or_delete();

revoke all on table clinical.validation_review_evaluation from public;
revoke all on table clinical.validation_review_evaluation from open_triage_api_runtime;
grant select, insert on table clinical.validation_review_evaluation
  to open_triage_api_runtime;

comment on table clinical.validation_review_evaluation is
  'Append-only server review results, separate from signing findings and signed report state.';
