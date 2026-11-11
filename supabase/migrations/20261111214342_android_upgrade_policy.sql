-- A server installation has one policy, independent of any agency or APK install date.
create table app_identity.android_upgrade_policy (
  singleton boolean primary key default true check (singleton),
  grace_days integer not null default 90 check (grace_days between 0 and 365),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references app_identity.app_user(id)
);
insert into app_identity.android_upgrade_policy(singleton) values (true);
create table app_identity.android_upgrade_policy_event (
  id bigint generated always as identity primary key,
  actor_id uuid not null references app_identity.app_user(id),
  occurred_at timestamptz not null default now(),
  action text not null check (action = 'android.upgrade-policy.update'),
  before_policy jsonb not null,
  after_policy jsonb not null,
  release_inputs_sha256 text not null check (release_inputs_sha256 ~ '^[a-f0-9]{64}$')
);
create index android_upgrade_policy_event_time_idx on app_identity.android_upgrade_policy_event(occurred_at desc, id desc);
create trigger android_upgrade_policy_event_append_only before update or delete on app_identity.android_upgrade_policy_event
  for each row execute function public.prevent_update_or_delete();
-- No browser, reporting, worker or Data API role receives installation-policy authority.
alter table app_identity.android_upgrade_policy enable row level security;
alter table app_identity.android_upgrade_policy_event enable row level security;
revoke all on app_identity.android_upgrade_policy, app_identity.android_upgrade_policy_event from public, open_triage_api_runtime;
grant select on app_identity.android_upgrade_policy to open_triage_api_runtime;
grant update (grace_days, revision, updated_at, updated_by) on app_identity.android_upgrade_policy to open_triage_api_runtime;
grant select, insert on app_identity.android_upgrade_policy_event to open_triage_api_runtime;
grant usage on sequence app_identity.android_upgrade_policy_event_id_seq to open_triage_api_runtime;
create policy android_upgrade_policy_runtime_read on app_identity.android_upgrade_policy for select to open_triage_api_runtime using (true);
create policy android_upgrade_policy_runtime_update on app_identity.android_upgrade_policy for update to open_triage_api_runtime
  using (true) with check (app_identity.is_installation_superadmin(updated_by));
create policy android_upgrade_policy_event_runtime_read on app_identity.android_upgrade_policy_event for select to open_triage_api_runtime using (true);
create policy android_upgrade_policy_event_runtime_insert on app_identity.android_upgrade_policy_event for insert to open_triage_api_runtime
  with check (app_identity.is_installation_superadmin(actor_id));
do $$ declare role_name text; begin
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on app_identity.android_upgrade_policy, app_identity.android_upgrade_policy_event from %I',role_name);
    end if;
  end loop;
end $$;
