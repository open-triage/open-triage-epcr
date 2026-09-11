-- Append-only, redacted evidence for server-authorized demo draft actions.
-- report_id intentionally has no foreign key because Delete removes the report in
-- the same transaction while the audit evidence must remain durable.
create table clinical_audit.synthetic_draft_mutation_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization (id),
  actor_id uuid not null,
  report_id uuid not null,
  command_id uuid,
  action text not null check (action in (
    'synthetic_draft.populate',
    'synthetic_draft.clear',
    'synthetic_draft.delete'
  )),
  target_count integer not null check (target_count >= 0),
  report_revision bigint check (report_revision is null or report_revision >= 0),
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, actor_id)
    references app_identity.app_user (organization_id, id),
  check ((action = 'synthetic_draft.delete') = (command_id is null)),
  check ((action = 'synthetic_draft.delete') = (report_revision is null))
);

create unique index synthetic_draft_mutation_event_command_idx
  on clinical_audit.synthetic_draft_mutation_event (command_id)
  where command_id is not null;

create index synthetic_draft_mutation_event_organization_time_idx
  on clinical_audit.synthetic_draft_mutation_event (organization_id, occurred_at desc);

create index synthetic_draft_mutation_event_actor_time_idx
  on clinical_audit.synthetic_draft_mutation_event (actor_id, occurred_at desc);

create index synthetic_draft_mutation_event_report_time_idx
  on clinical_audit.synthetic_draft_mutation_event (report_id, occurred_at desc);

create trigger synthetic_draft_mutation_event_append_only
before update or delete on clinical_audit.synthetic_draft_mutation_event
for each row execute function public.prevent_update_or_delete();

revoke all on clinical_audit.synthetic_draft_mutation_event from public;
