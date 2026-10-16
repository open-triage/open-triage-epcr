-- Private API-owned keys. Only encrypted key material is persisted; browser
-- responses contain the current version, never this envelope or raw key bytes.
create table app_identity.oidc_credential_key (
 group_id uuid not null references app_identity.group_authentication_policy(group_id),
 version integer not null check(version>0),
 encrypted_key jsonb not null check(jsonb_typeof(encrypted_key)='object'),
 created_by uuid not null references app_identity.app_user(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(group_id,version)
);
create index oidc_credential_key_actor_idx on app_identity.oidc_credential_key(created_by);
revoke all on app_identity.oidc_credential_key from public,anon,authenticated,open_triage_api_runtime;
grant select,insert on app_identity.oidc_credential_key to open_triage_api_runtime;
-- Automatic activation has no human actor. Once enabled, prerequisites remain
-- enforced even if a schedule, enrollment or provider later becomes unavailable.
alter table app_identity.production_workflow_rollout drop constraint production_workflow_rollout_check;
alter table app_identity.production_workflow_rollout add constraint production_workflow_actor_requires_activation
 check(enabled_at is not null or enabled_by is null);
