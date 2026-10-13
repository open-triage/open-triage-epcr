-- Versioned private configuration. The API is the sole authority; no Data API grants.
create table app_identity.oidc_provider_version (
  group_id uuid not null references app_identity.group_authentication_policy(group_id),
  revision bigint not null check (revision > 0),
  provider_id uuid not null,
  configuration jsonb not null check (jsonb_typeof(configuration)='object'),
  encrypted_credential jsonb check (encrypted_credential is null or jsonb_typeof(encrypted_credential)='object'),
  discovery jsonb,
  discovery_health text not null default 'unchecked' check (discovery_health in ('unchecked','healthy','failed')),
  discovered_at timestamptz,
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  primary key (group_id,revision)
);
create table app_identity.oidc_provider_state (
  group_id uuid primary key references app_identity.group_authentication_policy(group_id),
  draft_revision bigint not null,
  active_revision bigint,
  foreign key (group_id,draft_revision) references app_identity.oidc_provider_version(group_id,revision),
  foreign key (group_id,active_revision) references app_identity.oidc_provider_version(group_id,revision)
);
revoke all on app_identity.oidc_provider_version,app_identity.oidc_provider_state from public,open_triage_api_runtime;
create index oidc_provider_version_created_by on app_identity.oidc_provider_version(created_by);
grant select,insert on app_identity.oidc_provider_version to open_triage_api_runtime;
grant update(discovery,discovery_health,discovered_at) on app_identity.oidc_provider_version to open_triage_api_runtime;
grant select,insert(group_id,draft_revision),update(draft_revision) on app_identity.oidc_provider_state to open_triage_api_runtime;
-- Private API-owned schema follows the existing capability-enforced policy model.
-- Audit details contain revision IDs and health only; never configuration or credentials.
