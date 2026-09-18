-- Complete the immutable Validation version lifecycle with clone provenance,
-- source integrity, and append-only rule-level publication/activation history.

alter table validation.version
  add column cloned_from_id uuid,
  add column source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  add constraint validation_version_clone_organization_fk
    foreign key (organization_id, cloned_from_id)
    references validation.version (organization_id, id);

alter table validation.version disable trigger validation_version_immutable;

update validation.version
set source_sha256 = encode(public.digest(convert_to(source_rule::text, 'UTF8'), 'sha256'), 'hex')
where status = 'published' and source_sha256 is null;

alter table validation.version enable trigger validation_version_immutable;

alter table validation.version
  add constraint validation_version_source_integrity_check check (
    (status = 'draft' and source_sha256 is null)
    or (status = 'published' and source_sha256 is not null)
  );

create index validation_version_clone_idx
  on validation.version (cloned_from_id) where cloned_from_id is not null;

create or replace function validation.prevent_published_version_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'published' then
    raise exception 'published validation versions are immutable';
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id
     or new.catalog_release_id <> old.catalog_release_id or new.rule_id <> old.rule_id
     or new.cloned_from_id is distinct from old.cloned_from_id
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'validation version identity, clone provenance, and catalog binding are immutable';
  end if;
  return new;
end;
$$;

create table validation.change_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null references app_identity.app_user(id),
  action text not null check (action in ('validation.publish', 'validation.activate')),
  source_version_id uuid,
  destination_version_id uuid not null,
  catalog_release_id uuid not null references catalog.release(id),
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  rule_changes jsonb not null check (jsonb_typeof(rule_changes) = 'object'),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$'),
  compiled_sha256 text not null check (compiled_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, source_version_id)
    references validation.version (organization_id, id),
  foreign key (organization_id, destination_version_id)
    references validation.version (organization_id, id),
  check (not (rule_changes ?| array['password', 'password_verifier', 'token', 'csrf', 'clinical_content']))
);

create index validation_change_event_organization_time_idx
  on validation.change_event (organization_id, occurred_at desc, id desc);
create index validation_change_event_actor_time_idx
  on validation.change_event (actor_id, occurred_at desc);
create index validation_change_event_destination_idx
  on validation.change_event (destination_version_id, occurred_at desc);

create trigger validation_change_event_append_only
before update or delete on validation.change_event
for each row execute function public.prevent_update_or_delete();

revoke all on table validation.change_event from public;
grant select, insert on table validation.change_event to open_triage_api_runtime;
grant usage, select on sequence validation.change_event_id_seq to open_triage_api_runtime;
