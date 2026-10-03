-- Assignment commands advance an item version and append attributable history.
alter table clinical.review_item add column version bigint not null default 0 check (version >= 0);

create table clinical.review_assignment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  item_id uuid not null references clinical.review_item(id),
  command_id uuid not null,
  actor_id uuid not null,
  assignee_id uuid not null,
  item_version bigint not null check (item_version > 0),
  assigned_at timestamptz not null default now(),
  unique (item_id, command_id),
  unique (organization_id, command_id),
  unique (item_id, item_version),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id),
  foreign key (organization_id, assignee_id) references app_identity.app_user(organization_id, id)
);
create index review_assignment_history_item_idx on clinical.review_assignment_history (item_id, item_version desc);
create trigger review_assignment_history_append_only before update or delete on clinical.review_assignment_history
  for each row execute function public.prevent_update_or_delete();

revoke all on clinical.review_assignment_history from public, open_triage_api_runtime;
grant select, insert on clinical.review_assignment_history to open_triage_api_runtime;
