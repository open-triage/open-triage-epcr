-- Custom role names are stored in their canonical presentation form. This
-- keeps the active-name uniqueness index meaningful across every writer, not
-- only the HTTP API.
alter table app_identity.role
  add constraint role_display_name_normalized check (
    display_name = normalize(btrim(display_name), NFC)
    and display_name = regexp_replace(display_name, '[[:space:]]+', ' ', 'g')
    and display_name !~ '[[:cntrl:]]'
  ) not valid;
alter table app_identity.role validate constraint role_display_name_normalized;

alter table app_identity.role
  add constraint role_description_bounded_normalized check (
    description is null or (
      char_length(description) between 1 and 500
      and description = normalize(btrim(description), NFC)
      and description !~ '[[:cntrl:]]'
    )
  ) not valid;
alter table app_identity.role validate constraint role_description_bounded_normalized;

-- The partial unique index prevents an active custom role from taking a
-- protected role's name. Keep the invariant explicit for all protected names,
-- including a protected definition that may temporarily be inactive during an
-- operator-controlled repair.
create function app_identity.prevent_protected_role_shadow()
returns trigger language plpgsql as $$
begin
  if not new.protected and exists (
    select 1 from app_identity.role protected_role
    where protected_role.organization_id = new.organization_id
      and protected_role.protected
      and protected_role.id <> new.id
      and lower(protected_role.display_name) = lower(new.display_name)
  ) then
    raise exception 'protected role identities cannot be shadowed';
  end if;
  return new;
end;
$$;

create trigger protected_role_identity_not_shadowed
before insert or update of organization_id, display_name, protected
on app_identity.role
for each row execute function app_identity.prevent_protected_role_shadow();

-- Role creation has a cyclic deferred relationship with its first immutable
-- version. A deferred trigger records activation only after that version is
-- present, keeping the event and the role/version rows in one transaction.
create function app_identity.audit_initial_role_version_activation()
returns trigger language plpgsql as $$
declare selected_version app_identity.role_version%rowtype;
begin
  select * into selected_version
  from app_identity.role_version
  where id = new.current_version_id and role_id = new.id
    and organization_id = new.organization_id;
  if selected_version.id is null then
    raise exception 'initial role version is missing';
  end if;
  insert into app_identity.authorization_event
    (organization_id, actor_id, action, target_type, target_key, note, details)
  values (new.organization_id, selected_version.created_by, 'role.version_activate',
    'role_version', selected_version.id::text, selected_version.note,
    jsonb_build_object('roleId', new.id, 'priorVersionId', null,
      'version', selected_version.version));
  return new;
end;
$$;

create constraint trigger role_initial_version_activation_audit
after insert on app_identity.role
deferrable initially deferred for each row
execute function app_identity.audit_initial_role_version_activation();

revoke execute on function app_identity.prevent_protected_role_shadow(),
  app_identity.audit_initial_role_version_activation() from public;
