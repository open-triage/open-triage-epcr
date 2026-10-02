-- Saved analysis definitions are templates only. Results are recomputed under
-- each reader's current Review scope and selected dataset.
create table clinical.review_saved_analysis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  owner_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  shared boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, owner_id) references app_identity.app_user(organization_id, id)
);
create index review_saved_analysis_owner_idx
  on clinical.review_saved_analysis (organization_id, owner_id, updated_at desc, id);
create index review_saved_analysis_shared_idx
  on clinical.review_saved_analysis (organization_id, updated_at desc, id) where shared;

create table clinical.review_saved_analysis_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  analysis_id uuid not null,
  command_id uuid not null,
  actor_id uuid not null,
  version bigint not null check (version > 0),
  action text not null check (action in ('created', 'updated')),
  name text not null,
  definition jsonb not null,
  requested_definition jsonb not null,
  shared boolean not null,
  recorded_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (analysis_id, version),
  foreign key (organization_id, analysis_id)
    references clinical.review_saved_analysis(organization_id, id),
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id)
);
create trigger review_saved_analysis_history_append_only before update or delete
  on clinical.review_saved_analysis_history for each row
  execute function public.prevent_update_or_delete();

revoke all on clinical.review_saved_analysis, clinical.review_saved_analysis_history
  from public, anon, authenticated, open_triage_api_runtime;
grant select, insert, update on clinical.review_saved_analysis to open_triage_api_runtime;
grant select, insert on clinical.review_saved_analysis_history to open_triage_api_runtime;
