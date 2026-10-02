-- Deliberate retrospective work shares the ordinary immutable evaluation and
-- report/criterion item pipeline, but never enters prospective discovery.
alter table clinical.review_work
  add column source_key text not null default 'prospective',
  add column selected_criterion_id uuid,
  add constraint review_work_source_check check (
    (source_key = 'prospective' and selected_criterion_id is null) or
    (source_key = 'retrospective:' || selected_criterion_id::text and selected_criterion_id is not null));

do $$
declare old_name text;
begin
  select c.conname into old_name from pg_constraint c
  where c.conrelid = 'clinical.review_work'::regclass and c.contype = 'u'
    and pg_get_constraintdef(c.oid) like
      'UNIQUE (report_id, signed_snapshot_id, amendment_sequence, validation_version_id)%';
  if old_name is null then raise exception 'Expected Review work identity constraint is missing'; end if;
  execute format('alter table clinical.review_work drop constraint %I', old_name);
end $$;

alter table clinical.review_work add constraint review_work_source_unique
  unique (report_id, signed_snapshot_id, amendment_sequence, validation_version_id, source_key);
create index review_work_source_ready_idx on clinical.review_work (source_key, next_attempt_at, id)
  where state in ('pending', 'failed');

create table clinical.review_retrospective_run (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  command_id uuid not null,
  actor_id uuid not null,
  criterion_id uuid not null,
  validation_version_id uuid not null,
  dataset text not null check (dataset in ('real', 'synthetic')),
  report_scope text not null check (report_scope = 'all'),
  date_from date not null,
  date_to date not null,
  preview_hash text not null check (preview_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  check (date_from <= date_to),
  unique (organization_id, command_id),
  foreign key (organization_id, criterion_id)
    references validation.rule_identity(organization_id, id),
  foreign key (organization_id, validation_version_id)
    references validation.version(organization_id, id),
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id)
);
create index review_retrospective_run_list_idx
  on clinical.review_retrospective_run (organization_id, created_at desc, id);

create table clinical.review_retrospective_report (
  run_id uuid not null references clinical.review_retrospective_run(id),
  report_id uuid not null,
  organization_id uuid not null,
  signed_snapshot_id uuid not null references clinical.signed_snapshot(id),
  amendment_sequence integer not null check (amendment_sequence >= 0),
  reporting_date date not null,
  catalog_release_id uuid not null,
  preview_outcome text not null check (preview_outcome in ('match', 'no-match', 'failed', 'incompatible')),
  preview_existing boolean not null,
  failure_code text,
  work_id uuid references clinical.review_work(id),
  primary key (run_id, report_id),
  foreign key (organization_id, report_id) references clinical.report(organization_id, id)
);
create index review_retrospective_report_ready_idx
  on clinical.review_retrospective_report (run_id, report_id) where work_id is null;
create index review_retrospective_report_work_idx
  on clinical.review_retrospective_report (work_id) where work_id is not null;

revoke all on clinical.review_retrospective_run, clinical.review_retrospective_report
  from public, anon, authenticated, open_triage_api_runtime;
grant select, insert on clinical.review_retrospective_run to open_triage_api_runtime;
grant select, insert, update (work_id) on clinical.review_retrospective_report to open_triage_api_runtime;
