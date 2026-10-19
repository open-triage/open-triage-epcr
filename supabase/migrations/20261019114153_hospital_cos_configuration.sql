-- API-owned group configuration; no clinical copies or Data API exposure.
create table app_identity.hospital_cos_version (
  group_id uuid not null references app_identity.group_authentication_policy(group_id),
  revision bigint not null check (revision > 0),
  credential_id uuid not null,
  endpoint text not null,
  settings jsonb not null check(jsonb_typeof(settings)='object'),
  canonical_mapping jsonb not null check(jsonb_typeof(canonical_mapping)='object'),
  catalog_release_id uuid not null references catalog.release(id),
  form_version_id uuid not null references forms.form_version(id),
  encrypted_credential jsonb,
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(group_id,revision)
);
create table app_identity.hospital_cos_state (
  group_id uuid primary key references app_identity.group_authentication_policy(group_id),
  draft_revision bigint not null,
  active_revision bigint,
  state_revision bigint not null default 1,
  foreign key(group_id,draft_revision) references app_identity.hospital_cos_version(group_id,revision),
  foreign key(group_id,active_revision) references app_identity.hospital_cos_version(group_id,revision)
);
create table app_identity.hospital_cos_test (
  id uuid primary key,
  group_id uuid not null,
  revision bigint not null,
  result text not null check(result in ('healthy','failed')),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(group_id,revision) references app_identity.hospital_cos_version(group_id,revision)
);
create index hospital_cos_test_revision on app_identity.hospital_cos_test(group_id,revision,created_at desc);
create index hospital_cos_test_actor on app_identity.hospital_cos_test(created_by);
create index hospital_cos_version_actor on app_identity.hospital_cos_version(created_by);
create index hospital_cos_version_catalog on app_identity.hospital_cos_version(catalog_release_id);
create index hospital_cos_version_form on app_identity.hospital_cos_version(form_version_id);
revoke all on app_identity.hospital_cos_version,app_identity.hospital_cos_state,app_identity.hospital_cos_test from public,open_triage_api_runtime;
grant select,insert on app_identity.hospital_cos_version,app_identity.hospital_cos_test to open_triage_api_runtime;
grant select,insert,update on app_identity.hospital_cos_state to open_triage_api_runtime;
create trigger hospital_cos_version_append_only before update or delete on app_identity.hospital_cos_version
  for each row execute function public.prevent_update_or_delete();
create trigger hospital_cos_test_append_only before update or delete on app_identity.hospital_cos_test
  for each row execute function public.prevent_update_or_delete();

do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on app_identity.hospital_cos_version,app_identity.hospital_cos_state,app_identity.hospital_cos_test from %I',role_name);
    end if;
  end loop;
end $$;

-- Evidence ordering is completion order, including concurrent requests serialized
-- by the group lock. Transaction-start timestamps can put an older result last.
alter table app_identity.hospital_eps_test alter column created_at set default clock_timestamp();
