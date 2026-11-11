-- A current valid login is sufficient personal authority. Neither recovery nor
-- scheduled shift boundaries require another password/provider interaction.
-- Keep the shared helper so all grant/consume paths preserve their existing
-- owner, capability, enrollment and immutable-deadline checks.
-- Historical login issuance remains validated; later proof-policy changes do
-- not require an otherwise valid session to authenticate again.
create or replace function offline_recovery.session_has_recovery_proof(candidate app_identity.app_session, at_time timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select coalesce(candidate.revoked_at is null and candidate.expires_at > at_time
    and app_identity.session_authentication_valid(candidate)
    and exists (select 1 from app_identity.app_user u where u.id=candidate.user_id and u.active)
    and app_identity.user_can_access_organization(candidate.user_id,candidate.organization_id), false)
$$;
revoke all on function offline_recovery.session_has_recovery_proof(app_identity.app_session,timestamptz) from public;
