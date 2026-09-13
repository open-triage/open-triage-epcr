-- Installation ownership is an authority boundary, not a role assignment.
-- Owners receive the complete registered capability set while ordinary users
-- continue to derive authority exclusively from active roles.
create or replace function app_identity.validate_installation_owner()
returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from app_identity.app_user candidate
    where candidate.organization_id = new.organization_id
      and candidate.id = new.user_id and candidate.active
  ) then
    raise exception 'installation owner must be an active user in the organization';
  end if;
  return new;
end;
$$;

drop trigger owner_administrator_assignment_protected
  on app_identity.user_role_assignment;

update app_identity.user_role_assignment assignment
set ended_at = now(), ended_by = owner_record.user_id,
    note = coalesce(assignment.note, 'Ended when ownership became intrinsic authority')
from app_identity.installation_owner owner_record
where assignment.organization_id = owner_record.organization_id
  and assignment.user_id = owner_record.user_id and assignment.ended_at is null;

create or replace function app_identity.user_has_capability(
  candidate_user_id uuid,
  candidate_organization_id uuid,
  candidate_capability text
) returns boolean language sql stable security invoker as $$
  select exists (
    select 1 from app_identity.capability capability
    where capability.key = candidate_capability
  ) and exists (
    select 1
    from app_identity.app_user candidate
    where candidate.id = candidate_user_id
      and candidate.organization_id = candidate_organization_id
      and candidate.active
      and (
        exists (
          select 1 from app_identity.installation_owner owner_record
          where owner_record.organization_id = candidate.organization_id
            and owner_record.user_id = candidate.id
        )
        or exists (
          select 1
          from app_identity.user_role_assignment assignment
          join app_identity.role role
            on role.organization_id = assignment.organization_id and role.id = assignment.role_id
            and role.active and role.assignable
          join app_identity.role_version version
            on version.organization_id = role.organization_id and version.role_id = role.id
            and version.id = role.current_version_id
          join app_identity.role_version_capability definition
            on definition.organization_id = version.organization_id
            and definition.role_id = version.role_id and definition.role_version_id = version.id
          where assignment.organization_id = candidate.organization_id
            and assignment.user_id = candidate.id and assignment.ended_at is null
            and definition.capability_key = candidate_capability
            and exists (select 1 from app_identity.installation_owner installation
              where installation.organization_id = candidate.organization_id)
        )
      )
  );
$$;

revoke execute on function app_identity.validate_installation_owner() from public;
