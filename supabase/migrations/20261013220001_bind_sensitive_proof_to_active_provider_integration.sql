-- Activation pins its tested endpoints, never signing-key material. Diagnostic
-- inspection may update a draft even when it is also the active revision, but
-- cannot replace the working runtime metadata or its healthy activation status.
alter table app_identity.oidc_provider_state add column active_discovery jsonb
  check (active_discovery is null or jsonb_typeof(active_discovery)='object');
update app_identity.oidc_provider_state s set active_discovery=(
  select t.tested_discovery from app_identity.oidc_test_transaction t
  join app_identity.oidc_provider_version v on v.group_id=t.group_id and v.revision=t.revision
  where t.group_id=s.group_id and t.revision=s.active_revision and t.result='succeeded'
    and t.tested_discovery is not null and t.tested_discovery=v.discovery
    and t.completed_at<=(select max(e.occurred_at) from app_identity.authentication_event e
      where e.organization_id=s.group_id and e.result='succeeded' and e.details->>'kind'='oidc'
        and e.details->>'operation'='activate' and e.details->>'revision'=s.active_revision::text)
  order by t.completed_at desc,t.state_sha256 desc limit 1)
where s.active_revision is not null;
grant update(active_discovery) on app_identity.oidc_provider_state to open_triage_api_runtime;

-- Sensitive administration/recovery follows the current identity namespace.
-- Credential/configuration revisions within one integration retain valid proof;
-- changing issuer/client/provider cannot reuse the previous integration's proof.
-- Issued sessions, original provenance, expiry and qualifying shift evidence stay
-- unchanged. Both recovery grant and consume already call this shared helper.
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
            and identity.group_id=p.group_id and identity.provider_id=active.provider_id
            and identity.issuer=active.configuration->>'issuer' and identity.linked_user_id=candidate.user_id)
        else candidate.authentication_source='local' end
      from app_identity.group_authentication_policy p
      where p.group_id=app_identity.organization_group(candidate.organization_id)), false)
$$;
revoke all on function app_identity.session_proof_matches_policy(app_identity.app_session) from public;
grant execute on function app_identity.session_proof_matches_policy(app_identity.app_session) to open_triage_api_runtime;
