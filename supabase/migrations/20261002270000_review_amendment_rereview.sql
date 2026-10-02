-- Agency policy is versioned independently of clinical criteria and signing history.
create table clinical.review_amendment_policy (
  organization_id uuid primary key references app_identity.organization(id),
  clearance text not null default 'confirm' check (clearance in ('confirm', 'automatic')),
  version bigint not null default 0 check (version >= 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, updated_by) references app_identity.app_user(organization_id, id)
);
create table clinical.review_amendment_policy_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  command_id uuid not null,
  actor_id uuid not null,
  clearance text not null check (clearance in ('confirm', 'automatic')),
  policy_version bigint not null check (policy_version > 0),
  recorded_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (organization_id, policy_version),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id)
);
create trigger review_amendment_policy_history_append_only before update or delete
  on clinical.review_amendment_policy_history for each row
  execute function public.prevent_update_or_delete();

alter table clinical.review_item
  add column active_match boolean not null default true,
  add column clearance_pending boolean not null default false,
  add column reopened boolean not null default false,
  add column closure_reason text;
alter table clinical.review_work add constraint review_work_organization_id_unique unique (organization_id, id);
alter table clinical.review_evaluation add constraint review_evaluation_organization_id_unique unique (organization_id, id);

-- One durable decision per item and effective signed work, including a cleared criterion.
-- Lineage contains only identifiers and hashes; clinical values remain in signed sources.
create table clinical.review_amendment_decision (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  item_id uuid not null,
  work_id uuid not null,
  evaluation_id uuid not null,
  amendment_sequence integer not null check (amendment_sequence >= 0),
  matched boolean not null,
  lineage jsonb not null check (jsonb_typeof(lineage) = 'array'),
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  action text not null check (action in ('created', 'unchanged', 'reopened', 'confirmation-required', 'automatic-closure')),
  reason text,
  policy text check (policy in ('confirm', 'automatic')),
  item_version bigint not null check (item_version >= 0),
  recorded_at timestamptz not null default now(),
  unique (item_id, work_id),
  foreign key (organization_id, item_id) references clinical.review_item(organization_id, id),
  foreign key (organization_id, work_id) references clinical.review_work(organization_id, id),
  foreign key (organization_id, evaluation_id) references clinical.review_evaluation(organization_id, id)
);
create index review_amendment_decision_item_idx on clinical.review_amendment_decision
  (organization_id, item_id, recorded_at desc, id desc);
create trigger review_amendment_decision_append_only before update or delete
  on clinical.review_amendment_decision for each row
  execute function public.prevent_update_or_delete();

alter table clinical.review_progress_history alter column actor_id drop not null;
alter table clinical.review_progress_history drop constraint review_progress_history_status_check;
alter table clinical.review_progress_history add constraint review_progress_history_status_check
  check (status in ('new', 'in-review', 'awaiting-clinician', 'completed'));
alter table clinical.review_progress_history
  add column reason text,
  add column evaluation_id uuid references clinical.review_evaluation(id);

revoke all on clinical.review_amendment_policy, clinical.review_amendment_policy_history,
  clinical.review_amendment_decision from public, open_triage_api_runtime;
grant select, insert, update on clinical.review_amendment_policy to open_triage_api_runtime;
grant select, insert on clinical.review_amendment_policy_history,
  clinical.review_amendment_decision to open_triage_api_runtime;
