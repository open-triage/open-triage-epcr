-- Provenance is independent of password existence and of later provider rotation.
alter table app_identity.app_session
  alter column credential_version drop not null,
  add column authentication_source text not null default 'local' check (authentication_source in ('local','oidc')),
  add column authentication_purpose text not null default 'login' check (authentication_purpose in ('login','switch','reauthenticate')),
  add column personally_authenticated_at timestamptz,
  add column personal_authentication_purpose text check (personal_authentication_purpose in ('login','switch','reauthenticate')),
  add column oidc_identity_request_id uuid references app_identity.regional_identity_request(id),
  add column oidc_group_id uuid,
  add column oidc_revision bigint,
  add column personal_proof_policy_sha256 text check (personal_proof_policy_sha256 ~ '^[a-f0-9]{64}$'),
  add column personal_identity_request_id uuid references app_identity.regional_identity_request(id),
  add column personal_group_id uuid,
  add column personal_revision bigint,
  add column latest_personal_proof_policy_sha256 text check (latest_personal_proof_policy_sha256 ~ '^[a-f0-9]{64}$'),
  add column encrypted_csrf jsonb,
  add foreign key(oidc_group_id,oidc_revision) references app_identity.oidc_provider_version(group_id,revision),
  add foreign key(personal_group_id,personal_revision) references app_identity.oidc_provider_version(group_id,revision),
  add constraint app_session_authentication_provenance check (
    (authentication_source='local' and credential_version is not null and oidc_identity_request_id is null
      and oidc_group_id is null and oidc_revision is null and personal_proof_policy_sha256 is null and encrypted_csrf is null
      and personal_identity_request_id is null and personal_group_id is null and personal_revision is null and latest_personal_proof_policy_sha256 is null)
    or (authentication_source='oidc' and credential_version is null and oidc_identity_request_id is not null
      and oidc_group_id is not null and oidc_revision is not null and personally_authenticated_at is not null
      and personal_authentication_purpose is not null and personal_proof_policy_sha256 is not null
      and personal_identity_request_id is not null and personal_group_id is not null and personal_revision is not null and latest_personal_proof_policy_sha256 is not null
      and encrypted_csrf is not null and jsonb_typeof(encrypted_csrf)='object'));
update app_identity.app_session set personally_authenticated_at=coalesce(reauthenticated_at,created_at),
  personal_authentication_purpose=case when reauthenticated_at is null then 'login' else 'reauthenticate' end;
create index app_session_oidc_identity on app_identity.app_session(oidc_identity_request_id) where oidc_identity_request_id is not null;
create index app_session_oidc_version on app_identity.app_session(oidc_group_id,oidc_revision) where oidc_group_id is not null;
create index app_session_personal_identity on app_identity.app_session(personal_identity_request_id) where personal_identity_request_id is not null;
create index app_session_personal_version on app_identity.app_session(personal_group_id,personal_revision) where personal_group_id is not null;

-- Security invoker: private API schema, no Data API grants or user JWT trust.
create function app_identity.session_authentication_valid(candidate app_identity.app_session) returns boolean
language sql stable set search_path=pg_catalog,app_identity as $$
  select case when candidate.authentication_source='local' then exists(
    select 1 from app_identity.local_credential c where c.user_id=candidate.user_id
      and c.credential_version=candidate.credential_version)
  when candidate.authentication_source='oidc' then exists(
    select 1 from app_identity.regional_identity_request r
    join app_identity.oidc_provider_version v on v.group_id=candidate.oidc_group_id and v.revision=candidate.oidc_revision
    join app_identity.app_user u on u.id=candidate.user_id
    where r.id=candidate.oidc_identity_request_id and r.linked_user_id=u.id
      and u.active and u.account_scope='agency' and r.group_id=candidate.oidc_group_id
      and v.provider_id=r.provider_id and v.configuration->>'issuer'=r.issuer collate "C"
      and app_identity.organization_group(candidate.organization_id)=r.group_id
      and app_identity.organization_group(u.organization_id)=r.group_id
      and exists(select 1 from app_identity.regional_identity_request latest
        join app_identity.oidc_provider_version pv on pv.group_id=candidate.personal_group_id and pv.revision=candidate.personal_revision
        where latest.id=candidate.personal_identity_request_id and latest.linked_user_id=u.id
          and latest.group_id=r.group_id and candidate.personal_group_id=r.group_id
          and latest.provider_id=pv.provider_id and latest.issuer=pv.configuration->>'issuer' collate "C")
      and not exists(select 1 from app_identity.installation_owner where user_id=u.id)
      and not exists(select 1 from app_identity.installation_superadmin where user_id=u.id))
  else false end
$$;
revoke all on function app_identity.session_authentication_valid(app_identity.app_session) from public;
grant execute on function app_identity.session_authentication_valid(app_identity.app_session) to open_triage_api_runtime;
create function app_identity.validate_session_authentication() returns trigger
language plpgsql set search_path=pg_catalog,app_identity as $$
begin
  if tg_op='UPDATE' and (new.user_id,new.authentication_source,new.authentication_purpose,new.oidc_identity_request_id,
      new.oidc_group_id,new.oidc_revision,new.personal_proof_policy_sha256,new.encrypted_csrf,new.created_at)
    is distinct from (old.user_id,old.authentication_source,old.authentication_purpose,old.oidc_identity_request_id,
      old.oidc_group_id,old.oidc_revision,old.personal_proof_policy_sha256,old.encrypted_csrf,old.created_at) then
    raise exception 'Session authentication provenance is immutable' using errcode='23514';
  end if;
  if tg_op='INSERT' and new.authentication_source='oidc' and not app_identity.session_authentication_valid(new) then
    raise exception 'Session authentication provenance is invalid' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function app_identity.validate_session_authentication() from public;
create trigger app_session_authentication_valid before insert or update on app_identity.app_session
for each row execute function app_identity.validate_session_authentication();

create table app_identity.oidc_personal_transaction (
  state_sha256 text primary key check(state_sha256 ~ '^[a-f0-9]{64}$'),
  correlation_sha256 text not null check(correlation_sha256 ~ '^[a-f0-9]{64}$'),
  group_id uuid not null,
  revision bigint not null,
  organization_id uuid not null references app_identity.organization(id),
  origin text not null,
  purpose text not null check(purpose in ('login','switch','reauthenticate')),
  encrypted_binding jsonb not null check(jsonb_typeof(encrypted_binding)='object'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  completed_at timestamptz,
  result text check(result in ('succeeded','failed','pending')),
  foreign key(group_id,revision) references app_identity.oidc_provider_version(group_id,revision),
  check(expires_at>created_at and expires_at<=created_at+interval '5 minutes')
);
create index oidc_personal_transaction_version on app_identity.oidc_personal_transaction(group_id,revision);
create index oidc_personal_transaction_agency on app_identity.oidc_personal_transaction(organization_id);
revoke all on app_identity.oidc_personal_transaction from public,open_triage_api_runtime;
grant select,insert on app_identity.oidc_personal_transaction to open_triage_api_runtime;
grant update(consumed_at,completed_at,result) on app_identity.oidc_personal_transaction to open_triage_api_runtime;
