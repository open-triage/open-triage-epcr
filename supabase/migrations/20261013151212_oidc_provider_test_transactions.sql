-- Test attempts confer neither clinical sessions nor provider activation.
create table app_identity.oidc_test_transaction (
 state_sha256 text primary key,
 correlation_sha256 text not null,
 group_id uuid not null,
 revision bigint not null,
 organization_id uuid not null references app_identity.organization(id),
 actor_id uuid not null references app_identity.app_user(id),
 origin text not null,
 action text not null check(action='draft_test'),
 return_path text not null check(return_path='/'),
 encrypted_binding jsonb not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 result text check(result in ('succeeded','failed','canceled','stale')),
 failure_code text check(failure_code in ('canceled','expired','draft_changed','origin_changed','authority_changed','provider_validation','transaction_invalid')),
 completed_at timestamptz,
 pkce_s256 boolean not null,
 fresh_personal_authentication boolean not null default false check(not fresh_personal_authentication),
 foreign key(group_id,revision) references app_identity.oidc_provider_version(group_id,revision)
);
create index oidc_test_transaction_version on app_identity.oidc_test_transaction(group_id,revision,completed_at desc);
create index oidc_test_transaction_actor on app_identity.oidc_test_transaction(actor_id);
create index oidc_test_transaction_organization on app_identity.oidc_test_transaction(organization_id);
revoke all on app_identity.oidc_test_transaction from public,open_triage_api_runtime;
grant select,insert on app_identity.oidc_test_transaction to open_triage_api_runtime;
grant update(consumed_at,result,failure_code,completed_at) on app_identity.oidc_test_transaction to open_triage_api_runtime;
