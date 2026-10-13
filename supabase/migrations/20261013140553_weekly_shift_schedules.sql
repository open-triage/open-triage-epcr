-- Private application identity; browsers have no direct grants. API enforces group/agency scope.
create table app_identity.weekly_schedule (
  id uuid primary key,
  group_id uuid not null references app_identity.organization(id),
  name text not null check(length(btrim(name)) between 1 and 100),
  revision integer not null default 1 check(revision>0),
  unique(group_id,id)
);
create index weekly_schedule_group_idx on app_identity.weekly_schedule(group_id,name,id);
create table app_identity.weekly_schedule_version (
  schedule_id uuid not null references app_identity.weekly_schedule(id),
  revision integer not null check(revision>0),
  effective_at timestamptz not null,
  breakpoints jsonb not null check(jsonb_typeof(breakpoints)='array' and jsonb_array_length(breakpoints)<=168),
  actor_id uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(schedule_id,revision)
);
create index weekly_schedule_version_actor_idx on app_identity.weekly_schedule_version(actor_id);
create trigger weekly_schedule_version_immutable before update or delete on app_identity.weekly_schedule_version
  for each row execute function public.prevent_update_or_delete();
create table app_identity.unit_schedule_selection (
  organization_id uuid not null,
  unit_id uuid not null,
  revision integer not null check(revision>0),
  schedule_id uuid references app_identity.weekly_schedule(id),
  effective_at timestamptz not null,
  fallback_checkpoint jsonb,
  actor_id uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,unit_id,revision),
  foreign key(organization_id,unit_id) references app_identity.operational_unit(organization_id,id)
);
create index unit_schedule_selection_unit_idx on app_identity.unit_schedule_selection(unit_id,revision desc);
create index unit_schedule_selection_schedule_idx on app_identity.unit_schedule_selection(schedule_id);
create index unit_schedule_selection_actor_idx on app_identity.unit_schedule_selection(actor_id);
create trigger unit_schedule_selection_immutable before update or delete on app_identity.unit_schedule_selection
  for each row execute function public.prevent_update_or_delete();
create function app_identity.validate_unit_schedule_group() returns trigger language plpgsql security invoker
set search_path='' as $$
begin
  if new.schedule_id is not null and not exists (
    select 1 from app_identity.weekly_schedule schedule where schedule.id=new.schedule_id
      and schedule.group_id=app_identity.organization_group(new.organization_id)
  ) then raise exception 'Schedule belongs to another agency group' using errcode='23514'; end if;
  return new;
end;
$$;
revoke all on function app_identity.validate_unit_schedule_group() from public;
create trigger unit_schedule_selection_group before insert on app_identity.unit_schedule_selection
  for each row execute function app_identity.validate_unit_schedule_group();
create table app_identity.unit_schedule_evaluation (
  organization_id uuid not null,
  unit_id uuid not null,
  evaluated_at timestamptz not null,
  time_zone text not null,
  context_started_at timestamptz not null,
  selection_revision integer not null,
  fallback_checkpoint jsonb,
  details jsonb not null,
  primary key(organization_id,unit_id),
  foreign key(organization_id,unit_id) references app_identity.operational_unit(organization_id,id)
);
create index unit_schedule_evaluation_unit_idx on app_identity.unit_schedule_evaluation(unit_id);
revoke all on app_identity.weekly_schedule,app_identity.weekly_schedule_version,
  app_identity.unit_schedule_selection,app_identity.unit_schedule_evaluation from public,open_triage_api_runtime;
grant select,insert,update on app_identity.weekly_schedule,app_identity.unit_schedule_evaluation to open_triage_api_runtime;
grant select,insert on app_identity.weekly_schedule_version,app_identity.unit_schedule_selection to open_triage_api_runtime;
