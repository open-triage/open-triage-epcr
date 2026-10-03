-- Review workflow configuration is separate from published clinical rules.
create table clinical.review_criterion_route (
  organization_id uuid not null references app_identity.organization(id),
  criterion_id uuid not null,
  route text not null default 'unassigned' check (route in ('unassigned', 'author', 'named')),
  named_user_id uuid,
  independent_review boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  recovery_reason text,
  eligibility_checked_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (organization_id, criterion_id),
  foreign key (organization_id, criterion_id) references validation.rule_identity(organization_id, id),
  foreign key (organization_id, named_user_id) references app_identity.app_user(organization_id, id),
  foreign key (organization_id, updated_by) references app_identity.app_user(organization_id, id),
  check ((route = 'named') = (named_user_id is not null))
);
create index review_criterion_route_named_idx on clinical.review_criterion_route (organization_id, named_user_id)
  where named_user_id is not null;
create index review_criterion_route_check_idx on clinical.review_criterion_route (eligibility_checked_at nulls first)
  where route = 'named';

create table clinical.review_criterion_route_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  criterion_id uuid not null,
  command_id uuid not null,
  actor_id uuid,
  route text not null check (route in ('unassigned', 'author', 'named')),
  named_user_id uuid,
  route_version bigint not null check (route_version > 0),
  reason text not null check (reason in ('configured', 'ineligible')),
  recorded_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (organization_id, criterion_id, route_version),
  foreign key (organization_id, criterion_id) references validation.rule_identity(organization_id, id),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id),
  foreign key (organization_id, named_user_id) references app_identity.app_user(organization_id, id)
);
create trigger review_criterion_route_history_append_only before update or delete on clinical.review_criterion_route_history
  for each row execute function public.prevent_update_or_delete();

alter table clinical.review_item add column recovery_reason text;
alter table clinical.review_item add column eligibility_checked_at timestamptz;
create index review_item_eligibility_check_idx on clinical.review_item (eligibility_checked_at nulls first)
  where assignee_id is not null;
alter table clinical.review_assignment_history alter column actor_id drop not null;
alter table clinical.review_assignment_history alter column assignee_id drop not null;
alter table clinical.review_assignment_history add column previous_assignee_id uuid;
alter table clinical.review_assignment_history add column action text not null default 'claimed'
  check (action in ('claimed', 'assigned', 'routed', 'recovered'));
alter table clinical.review_assignment_history add column reason text;
alter table clinical.review_assignment_history add constraint review_assignment_history_previous_assignee_fkey
  foreign key (organization_id, previous_assignee_id) references app_identity.app_user(organization_id, id);

revoke all on clinical.review_criterion_route, clinical.review_criterion_route_history
  from public, open_triage_api_runtime;
grant select, insert, update on clinical.review_criterion_route to open_triage_api_runtime;
grant select, insert on clinical.review_criterion_route_history to open_triage_api_runtime;
