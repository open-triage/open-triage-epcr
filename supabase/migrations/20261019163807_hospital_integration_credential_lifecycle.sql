-- Paused integration retains its last activated revision independently from new drafts.
alter table app_identity.hospital_eps_state add column paused_revision bigint;
alter table app_identity.hospital_cos_state add column paused_revision bigint;
alter table app_identity.hospital_eps_state add foreign key(group_id,paused_revision) references app_identity.hospital_eps_version(group_id,revision);
alter table app_identity.hospital_cos_state add foreign key(group_id,paused_revision) references app_identity.hospital_cos_version(group_id,revision);
-- Only tested activations with byte-identical canonical mapping and operational settings
-- may authorize an older immutable preparation under a replacement credential.
create table app_identity.hospital_cos_credential_lineage (
 group_id uuid not null references app_identity.organization(id),
 predecessor_revision bigint not null,
 successor_revision bigint not null,
 test_id uuid not null references app_identity.hospital_cos_test(id),
 actor_id uuid not null references app_identity.app_user(id),
 created_at timestamptz not null default clock_timestamp(),
 primary key(group_id,successor_revision),
 check(successor_revision>predecessor_revision),
 foreign key(group_id,predecessor_revision) references app_identity.hospital_cos_version(group_id,revision),
 foreign key(group_id,successor_revision) references app_identity.hospital_cos_version(group_id,revision)
);
create function app_identity.validate_cos_credential_lineage() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from app_identity.hospital_cos_version predecessor
  join app_identity.hospital_cos_version replacement on replacement.group_id=predecessor.group_id
  join app_identity.hospital_cos_test test on test.group_id=replacement.group_id and test.revision=replacement.revision
  where predecessor.group_id=new.group_id and predecessor.revision=new.predecessor_revision and replacement.revision=new.successor_revision
   and predecessor.endpoint=replacement.endpoint and predecessor.settings=replacement.settings and predecessor.canonical_mapping=replacement.canonical_mapping
   and predecessor.form_version_id=replacement.form_version_id and predecessor.catalog_release_id=replacement.catalog_release_id
   and test.id=new.test_id and test.result='healthy'
   and test.id=(select latest.id from app_identity.hospital_cos_test latest where latest.group_id=new.group_id and latest.revision=new.successor_revision order by latest.created_at desc,latest.id desc limit 1)
   and exists(select 1 from app_identity.configuration_event event where event.organization_id=new.group_id
    and event.action='hospital.credential_replace' and event.details->>'integration'='cos'
    and event.details->>'revision'=new.successor_revision::text)
 ) then raise exception 'Invalid credential activation lineage'; end if;
 return new;
end $$;
revoke all on function app_identity.validate_cos_credential_lineage() from public;
create trigger hospital_cos_credential_lineage_validate before insert on app_identity.hospital_cos_credential_lineage
 for each row execute function app_identity.validate_cos_credential_lineage();
create trigger hospital_cos_credential_lineage_immutable before update or delete on app_identity.hospital_cos_credential_lineage
 for each row execute function public.prevent_update_or_delete();
alter table app_identity.hospital_cos_credential_lineage enable row level security;
create policy hospital_cos_credential_lineage_server on app_identity.hospital_cos_credential_lineage to open_triage_api_runtime using(true) with check(true);
revoke all on app_identity.hospital_cos_credential_lineage from public;
grant select,insert on app_identity.hospital_cos_credential_lineage to open_triage_api_runtime;
-- Monotonically increasing revisions prevent cycles. Ancestors are reached only through
-- explicit activation edges, never by inspecting a mutable latest mapping.
create function app_identity.cos_configuration_compatible(target_group uuid,prepared bigint,active bigint)
returns boolean language sql stable security invoker set search_path='' as $$
 select active is not null and exists(
  with recursive lineage(revision) as (
   select active
   union all
   select edge.predecessor_revision from app_identity.hospital_cos_credential_lineage edge
    join lineage on edge.successor_revision=lineage.revision where edge.group_id=target_group and edge.predecessor_revision>=prepared
  ) select 1 from lineage where revision=prepared
 )
$$;
revoke all on function app_identity.cos_configuration_compatible(uuid,bigint,bigint) from public;
grant execute on function app_identity.cos_configuration_compatible(uuid,bigint,bigint) to open_triage_api_runtime;
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
 if exists(select 1 from pg_roles where rolname=role_name) then
 execute format('revoke all on app_identity.hospital_cos_credential_lineage from %I',role_name);
 end if; end loop;
end $$;
alter table app_identity.configuration_event drop constraint configuration_event_action_check,
 add constraint configuration_event_action_check check(action in (
 'catalog.draft_delete','form.draft_create','form.draft_save','form.draft_delete','form.publish','form.activate','configuration.activate',
 'hospital.draft_save','hospital.test','hospital.activate','hospital.deactivate','hospital.credential_replace','hospital.resume'
 ));

create index hospital_cos_credential_predecessor on app_identity.hospital_cos_credential_lineage(group_id,predecessor_revision);
create index hospital_cos_credential_test on app_identity.hospital_cos_credential_lineage(test_id);
create index hospital_cos_credential_actor on app_identity.hospital_cos_credential_lineage(actor_id);
