-- Organization-scoped catalog drafts and sealed immutable publications.

alter table catalog.release add column sealed boolean not null default true;
alter table catalog.release drop constraint release_artifact_sha256_key;
create index catalog_release_artifact_sha256_idx on catalog.release (artifact_sha256);

drop trigger catalog_release_immutable on catalog.release;
create function catalog.prevent_sealed_release_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception '% rows are immutable', tg_table_name; end if;
  if old.sealed or not new.sealed
     or (to_jsonb(new) - 'sealed') is distinct from (to_jsonb(old) - 'sealed') then
    raise exception '% rows are immutable', tg_table_name;
  end if;
  return new;
end;
$$;
create trigger catalog_release_immutable before update or delete on catalog.release
for each row execute function catalog.prevent_sealed_release_mutation();

create function catalog.prevent_sealed_projection_mutation() returns trigger language plpgsql as $$
declare target_release_id uuid; target_sealed boolean;
begin
  if tg_op <> 'INSERT' then raise exception '% rows are immutable', tg_table_name; end if;
  target_release_id := new.release_id;
  select sealed into target_sealed from catalog.release where id = target_release_id;
  if target_sealed is distinct from false then
    raise exception 'catalog release % is sealed and immutable', target_release_id;
  end if;
  return new;
end;
$$;

drop trigger catalog_group_definition_immutable on catalog.group_definition;
drop trigger catalog_element_definition_immutable on catalog.element_definition;
drop trigger catalog_element_option_immutable on catalog.element_option;
drop trigger catalog_value_set_immutable on catalog.value_set;
drop trigger catalog_value_set_element_immutable on catalog.value_set_element;
drop trigger catalog_value_set_option_immutable on catalog.value_set_option;
drop trigger catalog_group_time_mapping_immutable on catalog.repeating_group_time_mapping;
drop trigger catalog_analytics_mapping_immutable on catalog.analytics_element_mapping;

create trigger catalog_group_definition_immutable before insert or update or delete on catalog.group_definition for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_element_definition_immutable before insert or update or delete on catalog.element_definition for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_element_option_immutable before insert or update or delete on catalog.element_option for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_value_set_immutable before insert or update or delete on catalog.value_set for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_value_set_element_immutable before insert or update or delete on catalog.value_set_element for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_value_set_option_immutable before insert or update or delete on catalog.value_set_option for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_group_time_mapping_immutable before insert or update or delete on catalog.repeating_group_time_mapping for each row execute function catalog.prevent_sealed_projection_mutation();
create trigger catalog_analytics_mapping_immutable before insert or update or delete on catalog.analytics_element_mapping for each row execute function catalog.prevent_sealed_projection_mutation();

alter table catalog.element_definition add column agency_required boolean;

create table catalog.authoring_draft (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  source_release_id uuid not null references catalog.release(id),
  revision integer not null default 1 check (revision >= 1),
  canonical_definition jsonb not null,
  definition_sha256 text not null check (definition_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_release_id uuid references catalog.release(id),
  published_at timestamptz,
  check ((published_release_id is null) = (published_at is null))
);
create unique index catalog_one_editable_draft_per_organization on catalog.authoring_draft (organization_id) where published_release_id is null;
create index catalog_authoring_draft_source_idx on catalog.authoring_draft (source_release_id);
create index catalog_authoring_draft_creator_idx on catalog.authoring_draft (created_by);
create index catalog_authoring_draft_publication_idx on catalog.authoring_draft (published_release_id) where published_release_id is not null;

create function catalog.prevent_published_draft_mutation() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.published_release_id is not null then
    raise exception 'published catalog drafts are immutable';
  end if;
  if new.published_release_id is not null and (
    new.organization_id is distinct from old.organization_id
    or new.source_release_id is distinct from old.source_release_id
    or new.revision is distinct from old.revision
    or new.canonical_definition is distinct from old.canonical_definition
    or new.definition_sha256 is distinct from old.definition_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'catalog content cannot change during publication';
  end if;
  return new;
end;
$$;
create trigger catalog_published_draft_immutable before update or delete on catalog.authoring_draft
for each row execute function catalog.prevent_published_draft_mutation();

create table catalog.publication_event (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null references app_identity.app_user(id),
  draft_id uuid not null references catalog.authoring_draft(id),
  release_id uuid not null references catalog.release(id),
  result text not null check (result in ('succeeded', 'denied', 'failed')),
  change_note text,
  definition_sha256 text check (definition_sha256 is null or definition_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default now()
);
create index catalog_publication_event_organization_time_idx on catalog.publication_event (organization_id, occurred_at desc);
create index catalog_publication_event_actor_time_idx on catalog.publication_event (actor_id, occurred_at desc);
create index catalog_publication_event_draft_idx on catalog.publication_event (draft_id);
create index catalog_publication_event_release_idx on catalog.publication_event (release_id);
create trigger catalog_publication_event_append_only before update or delete on catalog.publication_event for each row execute function public.prevent_update_or_delete();

revoke all on table catalog.authoring_draft, catalog.publication_event from public;
