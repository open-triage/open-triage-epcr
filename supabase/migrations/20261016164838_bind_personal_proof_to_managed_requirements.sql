-- A changed managed proof contract requires fresh personal authentication.
create or replace function app_identity.session_proof_matches_policy(candidate app_identity.app_session)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(app_identity.local_authentication_exception(candidate.user_id,candidate.organization_id)
    or (select case when p.mode='oidc' then candidate.authentication_source='oidc'
        and candidate.personal_group_id=p.group_id
        and exists(select 1 from app_identity.oidc_provider_state s
          join app_identity.oidc_provider_version active on active.group_id=s.group_id and active.revision=s.active_revision
          join app_identity.oidc_provider_version proof on proof.group_id=candidate.personal_group_id and proof.revision=candidate.personal_revision
          join app_identity.regional_identity_request identity on identity.id=candidate.personal_identity_request_id
          where s.group_id=p.group_id and proof.provider_id=active.provider_id
            and proof.configuration->>'issuer'=active.configuration->>'issuer'
            and proof.configuration->>'clientId'=active.configuration->>'clientId'
            and proof.configuration->'personalProof' is not distinct from active.configuration->'personalProof'
            and identity.group_id=p.group_id and identity.provider_id=active.provider_id
            and identity.issuer=active.configuration->>'issuer' and identity.linked_user_id=candidate.user_id)
        else candidate.authentication_source='local' end
      from app_identity.group_authentication_policy p
      where p.group_id=app_identity.organization_group(candidate.organization_id)), false)
$$;
revoke all on function app_identity.session_proof_matches_policy(app_identity.app_session) from public;
grant execute on function app_identity.session_proof_matches_policy(app_identity.app_session) to open_triage_api_runtime;
