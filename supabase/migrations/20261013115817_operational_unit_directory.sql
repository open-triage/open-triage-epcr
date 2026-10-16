-- Preserve legacy unit IDs and historical references; reports use agency configuration.
alter table app_identity.operational_unit alter column default_form_id drop not null;
alter table app_identity.operational_unit add column revision integer not null default 1 check (revision > 0);
create table app_identity.operational_unit_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  unit_id uuid not null,
  actor_id uuid not null references app_identity.app_user(id),
  occurred_at timestamptz not null default now(),
  details jsonb not null,
  foreign key (organization_id,unit_id) references app_identity.operational_unit(organization_id,id)
);
create index operational_unit_event_unit_idx on app_identity.operational_unit_event(organization_id,unit_id,occurred_at,id);
create index operational_unit_event_actor_idx on app_identity.operational_unit_event(actor_id);
create trigger operational_unit_event_append_only before update or delete on app_identity.operational_unit_event
  for each row execute function public.prevent_update_or_delete();
revoke all on app_identity.operational_unit_event from public;
grant select,insert on app_identity.operational_unit_event to open_triage_api_runtime;
grant usage on sequence app_identity.operational_unit_event_id_seq to open_triage_api_runtime;
revoke delete on app_identity.operational_unit from open_triage_api_runtime;
