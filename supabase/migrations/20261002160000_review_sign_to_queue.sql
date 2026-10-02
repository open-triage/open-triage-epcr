-- A signed snapshot is discovered independently by a bounded review worker.
-- Work is keyed by the immutable signing identity and the current amendment sequence.
create table clinical.review_work (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null,
  signed_snapshot_id uuid not null references clinical.signed_snapshot(id),
  amendment_sequence integer not null default 0 check (amendment_sequence >= 0),
  validation_version_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'complete', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (report_id, signed_snapshot_id, amendment_sequence, validation_version_id),
  foreign key (organization_id, report_id) references clinical.report(organization_id, id),
  foreign key (organization_id, validation_version_id) references validation.version(organization_id, id)
);
create index review_work_ready_idx on clinical.review_work (next_attempt_at, id)
  where state in ('pending', 'failed');
create index review_work_organization_state_idx on clinical.review_work (organization_id, state, created_at desc);

-- Immutable observations are separate from the mutable review workflow.
create table clinical.review_evaluation (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references clinical.review_work(id),
  attempt integer not null check (attempt > 0),
  unique (work_id, attempt),
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null,
  signed_snapshot_id uuid not null references clinical.signed_snapshot(id),
  signed_revision bigint not null check (signed_revision >= 0),
  amendment_sequence integer not null check (amendment_sequence >= 0),
  validation_version_id uuid not null,
  validation_compiled_sha256 text not null check (validation_compiled_sha256 ~ '^[a-f0-9]{64}$'),
  evaluated_at timestamptz not null,
  outcome text not null check (outcome in ('passed', 'findings', 'failed')),
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),
  failures jsonb not null default '[]'::jsonb check (jsonb_typeof(failures) = 'array'),
  foreign key (organization_id, report_id) references clinical.report(organization_id, id),
  foreign key (organization_id, validation_version_id) references validation.version(organization_id, id)
);
create index review_evaluation_report_idx on clinical.review_evaluation (organization_id, report_id, evaluated_at desc);
create trigger review_evaluation_append_only before update or delete on clinical.review_evaluation
  for each row execute function public.prevent_update_or_delete();

create table clinical.review_item (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  report_id uuid not null,
  criterion_id uuid not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  status text not null default 'new' check (status in ('new', 'in-review', 'resolved')),
  assignee_id uuid,
  first_matched_at timestamptz not null,
  updated_at timestamptz not null default now(),
  unique (organization_id, report_id, criterion_id),
  foreign key (organization_id, report_id) references clinical.report(organization_id, id),
  foreign key (organization_id, assignee_id) references app_identity.app_user(organization_id, id)
);
create index review_item_queue_idx on clinical.review_item (organization_id, status, priority, first_matched_at desc, id);
create index review_item_criterion_idx on clinical.review_item (organization_id, criterion_id, first_matched_at desc);

create table clinical.review_item_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  item_id uuid not null references clinical.review_item(id),
  evaluation_id uuid not null references clinical.review_evaluation(id),
  findings jsonb not null check (jsonb_typeof(findings) = 'array' and jsonb_array_length(findings) > 0),
  recorded_at timestamptz not null default now(),
  unique (item_id, evaluation_id)
);
create trigger review_item_evidence_append_only before update or delete on clinical.review_item_evidence
  for each row execute function public.prevent_update_or_delete();
create index review_item_evidence_item_idx on clinical.review_item_evidence (item_id, recorded_at desc);

revoke all on clinical.review_work, clinical.review_evaluation, clinical.review_item,
  clinical.review_item_evidence from public, open_triage_api_runtime;
grant select, insert, update on clinical.review_work to open_triage_api_runtime;
grant select, insert on clinical.review_evaluation, clinical.review_item_evidence to open_triage_api_runtime;
grant select, insert, update on clinical.review_item to open_triage_api_runtime;
