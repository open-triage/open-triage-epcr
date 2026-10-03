-- Shared Review discussion is independent of immutable clinical documentation.
-- The API requires report scope and review-identifying for all unrestricted text.
create table clinical.review_comment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  item_id uuid not null references clinical.review_item(id),
  command_id uuid not null,
  actor_id uuid not null,
  item_version bigint not null check (item_version > 0),
  kind text not null default 'comment' check (kind in ('comment', 'finding')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  recorded_at timestamptz not null default now(),
  unique (organization_id, command_id),
  unique (item_id, item_version),
  foreign key (organization_id, actor_id) references app_identity.app_user(organization_id, id)
);
create index review_comment_item_history_idx
  on clinical.review_comment (item_id, recorded_at, id);
create trigger review_comment_append_only before update or delete on clinical.review_comment
  for each row execute function public.prevent_update_or_delete();

revoke all on clinical.review_comment from public, open_triage_api_runtime;

-- Supabase roles are optional on standalone PostgreSQL installations.
do $$
declare optional_role text;
begin
  foreach optional_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = optional_role) then
      execute format('revoke all on clinical.review_comment from %I', optional_role);
    end if;
  end loop;
end;
$$;
grant select, insert on clinical.review_comment to open_triage_api_runtime;
