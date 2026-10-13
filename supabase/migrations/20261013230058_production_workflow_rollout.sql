-- Upgrades preserve legacy production access until a fresh-authenticated Admin
-- explicitly enables enrollment and shift checks for this agency group.
create table app_identity.production_workflow_rollout (
 group_id uuid primary key references app_identity.organization(id),
 revision integer not null default 1 check(revision>0),
 enabled_at timestamptz,
 enabled_by uuid references app_identity.app_user(id),
 check ((enabled_at is null)=(enabled_by is null))
);
create index production_workflow_rollout_actor_idx on app_identity.production_workflow_rollout(enabled_by);
insert into app_identity.production_workflow_rollout(group_id)
 select id from app_identity.organization where parent_organization_id is null;
create function app_identity.seed_production_workflow_rollout() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.parent_organization_id is null then
  insert into app_identity.production_workflow_rollout(group_id) values(new.id);
 end if;
 return new;
end $$;
create trigger organization_seed_production_workflow after insert on app_identity.organization
 for each row execute function app_identity.seed_production_workflow_rollout();
revoke all on app_identity.production_workflow_rollout from public,open_triage_api_runtime;
grant select,insert,update on app_identity.production_workflow_rollout to open_triage_api_runtime;
revoke all on function app_identity.seed_production_workflow_rollout() from public;
grant execute on function app_identity.seed_production_workflow_rollout() to open_triage_api_runtime;
-- Private schema, no browser or Data API grants. Capability checks remain live.
