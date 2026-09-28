-- Editable catalog drafts may be discarded. Published draft rows remain
-- immutable because they are durable provenance for publication events.
create or replace function catalog.prevent_published_draft_mutation()
returns trigger language plpgsql as $$
begin
  if old.published_release_id is not null then
    raise exception 'published catalog drafts are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
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

alter table app_identity.configuration_event
  drop constraint configuration_event_action_check,
  add constraint configuration_event_action_check
    check (action in (
      'catalog.draft_delete',
      'form.draft_create', 'form.draft_save', 'form.draft_delete',
      'form.publish', 'form.activate', 'configuration.activate'
    ));
