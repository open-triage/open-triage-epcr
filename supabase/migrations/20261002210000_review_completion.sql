-- Outcome revisions are immutable. A completed item pins the exact revision used.
create table clinical.review_outcome_option (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  current_revision integer not null default 1 check (current_revision > 0),
  unique (organization_id, id)
);

create table clinical.review_outcome_revision (
  option_id uuid not null,
  organization_id uuid not null,
  revision integer not null check (revision > 0),
  command_id uuid not null,
  actor_id uuid not null,
  label text not null check (length(trim(label)) between 1 and 120),
  meaning text not null check (length(trim(meaning)) between 1 and 1000),
  active boolean not null,
  recorded_at timestamptz not null default now(),
  primary key (option_id, revision),
  unique (organization_id, option_id, revision),
  unique (organization_id, command_id),
  foreign key (organization_id, option_id) references clinical.review_outcome_option(organization_id, id),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id)
);
alter table clinical.review_outcome_option add constraint review_outcome_current_revision_fk
  foreign key (id, current_revision) references clinical.review_outcome_revision(option_id, revision)
  deferrable initially deferred;
create trigger review_outcome_revision_append_only before update or delete on clinical.review_outcome_revision
  for each row execute function public.prevent_update_or_delete();

alter table clinical.review_item drop constraint review_item_status_check;
update clinical.review_item set status='completed' where status='resolved';
alter table clinical.review_item add constraint review_item_status_check
  check (status in ('new', 'in-review', 'awaiting-clinician', 'completed'));
alter table clinical.review_item add column outcome_option_id uuid,
  add column outcome_revision integer,
  add constraint review_item_outcome_pair_check
    check ((outcome_option_id is null) = (outcome_revision is null)),
  add constraint review_item_outcome_revision_fk
    foreign key (organization_id, outcome_option_id, outcome_revision)
    references clinical.review_outcome_revision(organization_id, option_id, revision);
alter table clinical.review_item add constraint review_item_organization_id_unique unique (organization_id, id);

create table clinical.review_progress_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  item_id uuid not null,
  command_id uuid not null,
  actor_id uuid not null,
  item_version bigint not null check (item_version > 0),
  status text not null check (status in ('in-review', 'awaiting-clinician', 'completed')),
  outcome_option_id uuid,
  outcome_revision integer,
  recorded_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (item_id, item_version),
  foreign key (organization_id, item_id) references clinical.review_item(organization_id, id),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id),
  foreign key (organization_id, outcome_option_id, outcome_revision)
    references clinical.review_outcome_revision(organization_id, option_id, revision),
  check ((outcome_option_id is null) = (outcome_revision is null))
);
create index review_progress_history_item_idx on clinical.review_progress_history (item_id, item_version);
create trigger review_progress_history_append_only before update or delete on clinical.review_progress_history
  for each row execute function public.prevent_update_or_delete();

revoke all on clinical.review_outcome_option, clinical.review_outcome_revision,
  clinical.review_progress_history from public, open_triage_api_runtime;
grant select, insert, update on clinical.review_outcome_option to open_triage_api_runtime;
grant select, insert on clinical.review_outcome_revision, clinical.review_progress_history
  to open_triage_api_runtime;
