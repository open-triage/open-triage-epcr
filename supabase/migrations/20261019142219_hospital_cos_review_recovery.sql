-- Delivery recovery is operational Review work with one stable report/reason identity.
alter table clinical.review_item drop constraint review_item_kind_check,
 drop constraint review_transmission_context,
 drop constraint review_item_transmission_reason_check,
 add constraint review_item_kind_check check(kind in ('criterion','overdue-unsigned','missing-transmission-identifiers','cos-delivery-failed')),
 add constraint review_item_transmission_reason_check check(transmission_reason in ('patient-identity','integration-mapping','delivery-failure')),
 add constraint review_transmission_context check(case kind
 when 'missing-transmission-identifiers' then transmission_reason is not null and transmission_reason in ('patient-identity','integration-mapping')
 when 'cos-delivery-failed' then transmission_reason is not null and transmission_reason='delivery-failure'
 else transmission_reason is null end);
create or replace function clinical.guard_transmission_completion() returns trigger language plpgsql as $$
begin
 if new.kind in ('missing-transmission-identifiers','cos-delivery-failed') and new.active_match and new.status='completed' then
  raise exception 'Unresolved transmission requirements cannot be completed with a generic outcome';
 end if;
 return new;
end $$;
create table clinical.cos_recovery_command (
 id uuid primary key,
 command_sha256 text not null,
 report_id uuid not null references clinical.report(id) on delete cascade,
 item_id uuid not null references clinical.review_item(id) on delete cascade,
 delivery_id uuid not null references clinical.cos_delivery(id) on delete cascade,
 actor_id uuid not null references app_identity.app_user(id),
 item_version bigint not null,
 amendment_sequence integer not null,
 configuration_revision bigint not null,
 mapping_sha256 text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(id,delivery_id)
);
create index cos_recovery_report on clinical.cos_recovery_command(report_id);
create index cos_recovery_item on clinical.cos_recovery_command(item_id);
create index cos_recovery_delivery on clinical.cos_recovery_command(delivery_id);
create index cos_recovery_actor on clinical.cos_recovery_command(actor_id);
alter table clinical.cos_attempt add column recovery_command_id uuid unique,
 add foreign key(recovery_command_id,delivery_id) references clinical.cos_recovery_command(id,delivery_id) on delete cascade;
create trigger cos_recovery_immutable before update or delete on clinical.cos_recovery_command
 for each row execute function public.prevent_update_or_delete();
revoke all on clinical.cos_recovery_command from public,open_triage_api_runtime;
grant select,insert on clinical.cos_recovery_command to open_triage_api_runtime;
alter table clinical.cos_recovery_command enable row level security;
create policy cos_recovery_server on clinical.cos_recovery_command to open_triage_api_runtime using(true) with check(true);
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
 if exists(select 1 from pg_roles where rolname=role_name) then
 execute format('revoke all on clinical.cos_recovery_command from %I',role_name);
 end if; end loop;
end $$;
