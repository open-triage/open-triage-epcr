-- Installation-superuser identity transfer, never ordinary agency/OIDC proof.
-- All browser intent, challenge and redemption secrets are stored as hashes.
create table app_identity.agency_session_handoff (
 id uuid primary key,
 source_session_id uuid not null references app_identity.app_session(id),
 target_organization_id uuid not null references app_identity.organization(id),
 source_origin text not null check(length(source_origin)<=2048),
 target_origin text not null check(length(target_origin)<=2048),
 verifier_sha256 text not null check(verifier_sha256 ~ '^[a-f0-9]{64}$'),
 challenge_sha256 text check(challenge_sha256 ~ '^[a-f0-9]{64}$'),
 code_sha256 text check(code_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,
 issued_at timestamptz,
 consumed_at timestamptz,
 check(expires_at>created_at and expires_at<=created_at+interval '2 minutes'),
 check((issued_at is null)=(code_sha256 is null)),
 check(consumed_at is null or issued_at is not null)
);
create index agency_session_handoff_source_idx on app_identity.agency_session_handoff(source_session_id);
create index agency_session_handoff_target_idx on app_identity.agency_session_handoff(target_organization_id);
create index agency_session_handoff_expiry_idx on app_identity.agency_session_handoff(expires_at);
revoke all on app_identity.agency_session_handoff from public,anon,authenticated,open_triage_api_runtime;
grant select,insert on app_identity.agency_session_handoff to open_triage_api_runtime;
grant update(challenge_sha256,code_sha256,issued_at,consumed_at) on app_identity.agency_session_handoff to open_triage_api_runtime;
