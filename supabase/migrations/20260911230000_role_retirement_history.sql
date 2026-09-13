-- Preserve the presentation attached to every immutable definition. Existing
-- versions predate snapshots, so their current role presentation is the only
-- safe value available for the one-time backfill.
alter table app_identity.role_version
  add column display_name text,
  add column description text;

-- The immutable-history trigger intentionally rejects ordinary updates. This
-- narrowly bounded migration backfill is the sole exception and is restored
-- before any later statement can expose the table to application writers.
alter table app_identity.role_version disable trigger role_version_immutable;
update app_identity.role_version version
set display_name = role.display_name,
    description = role.description
from app_identity.role role
where role.id = version.role_id and role.organization_id = version.organization_id;
alter table app_identity.role_version enable trigger role_version_immutable;

create function app_identity.snapshot_role_version_presentation()
returns trigger language plpgsql as $$
begin
  if new.display_name is null then
    select role.display_name, role.description
    into new.display_name, new.description
    from app_identity.role role
    where role.id = new.role_id and role.organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

create trigger role_version_presentation_snapshot
before insert on app_identity.role_version
for each row execute function app_identity.snapshot_role_version_presentation();

alter table app_identity.role_version alter column display_name set not null;
alter table app_identity.role_version
  add constraint role_version_display_name_normalized check (
    display_name = normalize(btrim(display_name), NFC)
    and display_name = regexp_replace(display_name, '[[:space:]]+', ' ', 'g')
    and display_name !~ '[[:cntrl:]]'
  ),
  add constraint role_version_description_bounded check (
    description is null or (
      char_length(description) between 1 and 500
      and description = normalize(btrim(description), NFC)
      and description !~ '[[:cntrl:]]'
    )
  );

-- Custom roles are assignable exactly while active. Protected roles retain
-- their registry-defined assignability (including the hidden Reviewer role).
alter table app_identity.role
  add constraint custom_role_active_assignable check (protected or active = assignable);

create function app_identity.validate_current_role_presentation()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from app_identity.role_version version
    where version.organization_id = new.organization_id and version.role_id = new.id
      and version.id = new.current_version_id
      and version.display_name = new.display_name
      and version.description is not distinct from new.description
  ) then
    raise exception 'current role presentation must match its immutable version';
  end if;
  return new;
end;
$$;

create constraint trigger current_role_presentation_matches_version
after insert or update of current_version_id, display_name, description on app_identity.role
deferrable initially deferred for each row
execute function app_identity.validate_current_role_presentation();

-- Closed assignment rows are authority history. Permit exactly one transition
-- from open to closed and reject deletion or any later rewriting.
create function app_identity.preserve_role_assignment_interval()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'role assignment history is immutable';
  end if;
  if old.ended_at is not null
    or (to_jsonb(new) - array['ended_at', 'ended_by', 'note'])
      <> (to_jsonb(old) - array['ended_at', 'ended_by', 'note'])
    or new.ended_at is null or new.ended_by is null
  then
    raise exception 'role assignment history permits only closure';
  end if;
  return new;
end;
$$;

create trigger role_assignment_interval_immutable
before update or delete on app_identity.user_role_assignment
for each row execute function app_identity.preserve_role_assignment_interval();

-- A role may not commit inactive while retaining an open assignment, keeping
-- direct SQL writers subject to the same atomic retirement invariant as HTTP.
create function app_identity.validate_role_retirement()
returns trigger language plpgsql as $$
begin
  if not new.active and exists (
    select 1 from app_identity.user_role_assignment assignment
    where assignment.organization_id = new.organization_id
      and assignment.role_id = new.id and assignment.ended_at is null
  ) then
    raise exception 'inactive roles cannot retain current assignments';
  end if;
  return new;
end;
$$;

create constraint trigger role_retirement_closes_assignments
after insert or update of active on app_identity.role
deferrable initially deferred for each row
execute function app_identity.validate_role_retirement();

alter table app_identity.authorization_event
  drop constraint authorization_event_action_check;
alter table app_identity.authorization_event
  add constraint authorization_event_action_check check (action in (
    'capability.register', 'capability.change',
    'role.protected_register', 'role.version_activate',
    'role.deactivate', 'role.reactivate'
  ));

revoke execute on function app_identity.preserve_role_assignment_interval(),
  app_identity.validate_role_retirement(),
  app_identity.validate_current_role_presentation(),
  app_identity.snapshot_role_version_presentation() from public;
