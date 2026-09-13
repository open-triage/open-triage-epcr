-- The accountable owner must always retain both protected operational roles.
-- Administrator remains non-clinical for every non-owner account.
insert into app_identity.user_role_assignment
  (organization_id, user_id, role_id, assigned_by, note)
select owner_record.organization_id, owner_record.user_id, role.id, owner_record.user_id,
       'Required for installation ownership'
from app_identity.installation_owner owner_record
join app_identity.role role
  on role.organization_id = owner_record.organization_id
 and role.system_key = 'clinician' and role.protected and role.active and role.assignable
where not exists (
  select 1 from app_identity.user_role_assignment assignment
  where assignment.organization_id = owner_record.organization_id
    and assignment.user_id = owner_record.user_id
    and assignment.role_id = role.id and assignment.ended_at is null
);

create or replace function app_identity.validate_installation_owner()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1
    from unnest(array['administrator', 'clinician']) required(system_key)
    where not exists (
      select 1
      from app_identity.app_user u
      join app_identity.user_role_assignment assignment
        on assignment.organization_id = u.organization_id
       and assignment.user_id = u.id and assignment.ended_at is null
      join app_identity.role role
        on role.organization_id = assignment.organization_id and role.id = assignment.role_id
      where u.organization_id = new.organization_id and u.id = new.user_id and u.active
        and role.system_key = required.system_key and role.protected and role.active and role.assignable
    )
  ) then
    raise exception 'installation owner must be an active Administrator and Clinician';
  end if;
  return new;
end;
$$;

create or replace function app_identity.protect_owner_administrator_assignment()
returns trigger language plpgsql as $$
declare
  protected_assignment boolean;
begin
  perform 1 from app_identity.installation_owner owner_record
    where owner_record.organization_id = old.organization_id for update;
  select exists (
    select 1
    from app_identity.installation_owner owner_record
    join app_identity.role role
      on role.organization_id = old.organization_id and role.id = old.role_id
    where owner_record.organization_id = old.organization_id
      and owner_record.user_id = old.user_id
      and role.system_key in ('administrator', 'clinician')
      and old.ended_at is null
  ) into protected_assignment;
  if protected_assignment and (
    tg_op = 'DELETE' or new.ended_at is not null or new.organization_id <> old.organization_id
    or new.user_id <> old.user_id or new.role_id <> old.role_id
  ) then
    raise exception 'installation owner Administrator and Clinician assignments cannot be removed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke execute on function app_identity.validate_installation_owner(),
  app_identity.protect_owner_administrator_assignment() from public;
