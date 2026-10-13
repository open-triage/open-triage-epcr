-- Activation changes the next authentication path, never historical issuance or expiry.
alter table app_identity.group_authentication_policy
  add column mode text not null default 'local' check (mode in ('local','oidc'));
alter table app_identity.oidc_test_transaction add column tested_discovery jsonb;
grant update(active_revision) on app_identity.oidc_provider_state to open_triage_api_runtime;
grant update(tested_discovery) on app_identity.oidc_test_transaction to open_triage_api_runtime;

-- Installation recovery is independent. Only the immutable demonstration fixture
-- in its own tenant can keep local demo login; synthetic flags never grant a bypass.
create function app_identity.local_authentication_exception(candidate_user uuid, candidate_organization uuid)
returns boolean language sql stable set search_path = '' as $$
  select app_identity.is_installation_owner(candidate_user)
    or app_identity.is_installation_superadmin(candidate_user)
    or (candidate_user='32000000-0000-4000-8000-000000000002'::uuid
      and candidate_organization='32000000-0000-4000-8000-000000000001'::uuid
      and exists(select 1 from app_identity.app_user u join app_identity.local_credential c on c.user_id=u.id
        where u.id=candidate_user and u.organization_id=candidate_organization and u.active and c.username='demo'
          and app_identity.user_has_capability(u.id,candidate_organization,'clinical:demo')
          and exists(select 1 from app_identity.user_role_assignment a join app_identity.role r on r.id=a.role_id
            where a.user_id=u.id and a.ended_at is null and r.active and r.protected and r.system_key='demo')
          and not exists(select 1 from app_identity.user_role_assignment a join app_identity.role r on r.id=a.role_id
            where a.user_id=u.id and a.ended_at is null and r.system_key is distinct from 'demo')))
$$;
revoke all on function app_identity.local_authentication_exception(uuid,uuid) from public;
grant execute on function app_identity.local_authentication_exception(uuid,uuid) to open_triage_api_runtime;
create function app_identity.session_proof_matches_policy(candidate app_identity.app_session)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(app_identity.local_authentication_exception(candidate.user_id,candidate.organization_id)
    or (select case when p.mode='oidc' then candidate.authentication_source='oidc'
        else candidate.authentication_source='local' end
      from app_identity.group_authentication_policy p
      where p.group_id=app_identity.organization_group(candidate.organization_id)), false)
$$;
revoke all on function app_identity.session_proof_matches_policy(app_identity.app_session) from public;
grant execute on function app_identity.session_proof_matches_policy(app_identity.app_session) to open_triage_api_runtime;

-- Both grant and consume use this helper, including privileged key-release paths.
create or replace function offline_recovery.session_has_recovery_proof(candidate app_identity.app_session, at_time timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((app_identity.session_proof_matches_policy(candidate)
    and coalesce(candidate.personally_authenticated_at,candidate.reauthenticated_at) between at_time-interval '5 minutes' and at_time
    and (candidate.personal_authentication_purpose='reauthenticate'
      or candidate.personal_authentication_purpose is null and candidate.reauthenticated_at is not null)), false)
$$;
