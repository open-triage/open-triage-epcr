-- API-owned group configuration; no clinical copies or Data API exposure.
create table app_identity.hospital_eps_version (
  group_id uuid not null references app_identity.group_authentication_policy(group_id),
  revision bigint not null check (revision > 0),
  credential_id uuid not null,
  endpoint text not null,
  canonical_mapping jsonb not null check(jsonb_typeof(canonical_mapping)='object'),
  catalog_release_id uuid not null references catalog.release(id),
  form_version_id uuid not null references forms.form_version(id),
  encrypted_credential jsonb,
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  primary key(group_id,revision)
);
create table app_identity.hospital_eps_state (
  group_id uuid primary key references app_identity.group_authentication_policy(group_id),
  draft_revision bigint not null,
  active_revision bigint,
  state_revision bigint not null default 1,
  foreign key(group_id,draft_revision) references app_identity.hospital_eps_version(group_id,revision),
  foreign key(group_id,active_revision) references app_identity.hospital_eps_version(group_id,revision)
);
create table app_identity.hospital_eps_test (
  id uuid primary key,
  group_id uuid not null,
  revision bigint not null,
  result text not null check(result in ('healthy','failed')),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  foreign key(group_id,revision) references app_identity.hospital_eps_version(group_id,revision)
);
create index hospital_eps_test_revision on app_identity.hospital_eps_test(group_id,revision,created_at desc);
create index hospital_eps_test_actor on app_identity.hospital_eps_test(created_by);
create index hospital_eps_version_actor on app_identity.hospital_eps_version(created_by);
create index hospital_eps_version_catalog on app_identity.hospital_eps_version(catalog_release_id);
create index hospital_eps_version_form on app_identity.hospital_eps_version(form_version_id);
revoke all on app_identity.hospital_eps_version,app_identity.hospital_eps_state,app_identity.hospital_eps_test from public,open_triage_api_runtime;
grant select,insert on app_identity.hospital_eps_version,app_identity.hospital_eps_test to open_triage_api_runtime;
grant select,insert,update on app_identity.hospital_eps_state to open_triage_api_runtime;
alter table app_identity.configuration_event drop constraint configuration_event_action_check,
  add constraint configuration_event_action_check check(action in (
    'catalog.draft_delete','form.draft_create','form.draft_save','form.draft_delete','form.publish','form.activate','configuration.activate',
    'hospital.draft_save','hospital.test','hospital.activate','hospital.deactivate'
  ));
create trigger hospital_eps_version_append_only before update or delete on app_identity.hospital_eps_version
  for each row execute function public.prevent_update_or_delete();
create trigger hospital_eps_test_append_only before update or delete on app_identity.hospital_eps_test
  for each row execute function public.prevent_update_or_delete();

do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on app_identity.hospital_eps_version,app_identity.hospital_eps_state,app_identity.hospital_eps_test from %I',role_name);
    end if;
  end loop;
end $$;
