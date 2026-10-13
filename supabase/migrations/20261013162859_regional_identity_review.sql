-- Regional profile attributes are untrusted display hints. Identity and ownership
-- are immutable; the API performs current capability and fresh-auth checks.
create table app_identity.regional_identity_request (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references app_identity.group_authentication_policy(group_id),
  provider_id uuid not null,
  first_revision bigint not null,
  organization_id uuid not null references app_identity.organization(id),
  issuer text collate "C" not null check (octet_length(issuer) between 1 and 2048),
  subject text collate "C" not null check (octet_length(subject) between 1 and 255),
  display_name text check (char_length(display_name) <= 256),
  email text check (char_length(email) <= 320),
  created_at timestamptz not null default now(),
  linked_user_id uuid references app_identity.app_user(id),
  linked_by uuid references app_identity.app_user(id),
  linked_at timestamptz,
  foreign key(group_id,first_revision) references app_identity.oidc_provider_version(group_id,revision),
  unique(group_id,provider_id,issuer,subject),
  check ((linked_user_id is null and linked_by is null and linked_at is null)
    or (linked_user_id is not null and linked_by is not null and linked_at is not null))
);
create index regional_identity_request_directory on app_identity.regional_identity_request(group_id,created_at desc,id desc);
create index regional_identity_request_organization on app_identity.regional_identity_request(organization_id);
create index regional_identity_request_reviewer on app_identity.regional_identity_request(linked_by);
create index regional_identity_request_user on app_identity.regional_identity_request(linked_user_id) where linked_user_id is not null;

create function app_identity.validate_regional_identity_request() returns trigger
language plpgsql set search_path = pg_catalog, app_identity as $$
begin
  if tg_op = 'UPDATE' and (new.id,new.group_id,new.provider_id,new.first_revision,new.organization_id,
      new.issuer,new.subject,new.display_name,new.email,new.created_at)
    is distinct from (old.id,old.group_id,old.provider_id,old.first_revision,old.organization_id,
      old.issuer,old.subject,old.display_name,old.email,old.created_at) then
    raise exception 'Regional identity keys and display evidence are immutable' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' and old.linked_user_id is not null and
    (new.linked_user_id,new.linked_by,new.linked_at) is distinct from
    (old.linked_user_id,old.linked_by,old.linked_at) then
    raise exception 'Regional identity is already linked' using errcode='23514';
  end if;
  if not exists(select 1 from app_identity.oidc_provider_version v where v.group_id=new.group_id
      and v.revision=new.first_revision and v.provider_id=new.provider_id
      and v.configuration->>'issuer'=new.issuer collate "C")
    or app_identity.organization_group(new.organization_id) is distinct from new.group_id then
    raise exception 'Regional identity integration scope is invalid' using errcode='23514';
  end if;
  if new.linked_user_id is not null then
    -- Serialize with account disablement, group moves and protected owner changes.
    perform 1 from app_identity.app_user where id=new.linked_user_id for update;
    if not exists(select 1 from app_identity.app_user u where u.id=new.linked_user_id and u.active
        and u.account_scope='agency' and app_identity.organization_group(u.organization_id)=new.group_id)
      or exists(select 1 from app_identity.installation_owner where user_id=new.linked_user_id)
      or exists(select 1 from app_identity.installation_superadmin where user_id=new.linked_user_id) then
      raise exception 'Regional identity target is not an ordinary active group user' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_identity.validate_regional_identity_request() from public;
create trigger regional_identity_request_valid before insert or update on app_identity.regional_identity_request
for each row execute function app_identity.validate_regional_identity_request();
revoke all on app_identity.regional_identity_request from public,open_triage_api_runtime;
grant select on app_identity.regional_identity_request to open_triage_api_runtime;
grant insert(group_id,provider_id,first_revision,organization_id,issuer,subject,display_name,email)
  on app_identity.regional_identity_request to open_triage_api_runtime;
grant update(linked_user_id,linked_by,linked_at) on app_identity.regional_identity_request to open_triage_api_runtime;

alter table app_identity.oidc_test_transaction add column identity_request_id uuid
  references app_identity.regional_identity_request(id);
create index oidc_test_transaction_identity_request on app_identity.oidc_test_transaction(identity_request_id)
  where identity_request_id is not null;
grant update(identity_request_id) on app_identity.oidc_test_transaction to open_triage_api_runtime;
