-- Owners and installation super users retain administration, but receive the
-- clinician patient-data scope. Sessions and reviewer eligibility resolve this
-- function on every request; existing sessions immediately lose broad review.
create or replace function app_identity.user_has_capability(
  candidate_user_id uuid, candidate_organization_id uuid, candidate_capability text
) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app_identity.capability where key = candidate_capability)
    and app_identity.user_can_access_organization(candidate_user_id, candidate_organization_id)
    -- Installation authority never grants access to another clinician's patients.
    -- Keep this outside the role branch: assigning a reviewer/custom role cannot
    -- bypass the ceiling, including in another agency or organization family.
    and (not app_identity.is_installation_superadmin(candidate_user_id)
      or candidate_capability not in ('review:all', 'review:admin', 'review:identifying'))
    and (app_identity.is_installation_superadmin(candidate_user_id) or
      (exists (select 1 from app_identity.installation_owner) and exists (
        select 1 from app_identity.user_role_assignment assignment
        join app_identity.role role on role.id = assignment.role_id
          and role.organization_id = assignment.organization_id and role.active and role.assignable
        join app_identity.role_version_capability definition on definition.role_version_id = role.current_version_id
          and definition.role_id = role.id and definition.organization_id = role.organization_id
        where assignment.user_id = candidate_user_id and assignment.ended_at is null
          and app_identity.organization_group(assignment.organization_id) = app_identity.organization_group(candidate_organization_id)
          and definition.capability_key = candidate_capability)));
$$;

