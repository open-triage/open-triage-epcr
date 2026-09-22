-- Drafts are replaceable working copies; published versions remain immutable.
create or replace function validation.prevent_published_version_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'draft' then return old; end if;
    raise exception 'published validation versions are immutable';
  end if;
  if old.status = 'published' then
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
