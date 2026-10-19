-- Immutable policy explanation; mutable due work shares report retention and the report advisory lock.
create table clinical.cos_retry_policy (
 delivery_id uuid primary key references clinical.cos_delivery(id) on delete cascade,
 report_id uuid not null references clinical.report(id) on delete cascade,
 configuration_revision bigint not null,
 foreign key(delivery_id,report_id) references clinical.cos_delivery(id,report_id) on delete cascade,
 schedule_minutes jsonb not null check(jsonb_typeof(schedule_minutes)='array' and jsonb_array_length(schedule_minutes)<=5),
 jitter_percent integer not null default 10 check(jitter_percent=10)
);
create index cos_retry_policy_report on clinical.cos_retry_policy(report_id);
create trigger cos_retry_policy_immutable before update or delete on clinical.cos_retry_policy
 for each row execute function public.prevent_update_or_delete();
create table clinical.cos_retry_state (
 delivery_id uuid primary key references clinical.cos_retry_policy(delivery_id) on delete cascade,
 retries_used integer not null default 0 check(retries_used between 0 and 5),
 next_due timestamptz,
 check(next_due is null or retries_used<5)
);
create index cos_retry_due on clinical.cos_retry_state(next_due,delivery_id) where next_due is not null;
alter table clinical.cos_recovery_command alter column actor_id drop not null,
 add column automatic_ordinal integer check(automatic_ordinal between 1 and 5),
 add constraint cos_recovery_actor_kind check((actor_id is null)=(automatic_ordinal is not null));
create unique index cos_recovery_automatic_ordinal on clinical.cos_recovery_command(delivery_id,automatic_ordinal) where automatic_ordinal is not null;
alter table clinical.cos_retry_policy enable row level security;
alter table clinical.cos_retry_state enable row level security;
create policy cos_retry_policy_server on clinical.cos_retry_policy to open_triage_api_runtime using(true) with check(true);
create policy cos_retry_state_server on clinical.cos_retry_state to open_triage_api_runtime using(true) with check(true);
revoke all on clinical.cos_retry_policy,clinical.cos_retry_state from public,open_triage_api_runtime;
grant select,insert on clinical.cos_retry_policy,clinical.cos_retry_state to open_triage_api_runtime;
grant update(retries_used,next_due) on clinical.cos_retry_state to open_triage_api_runtime;
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
 if exists(select 1 from pg_roles where rolname=role_name) then
 execute format('revoke all on clinical.cos_retry_policy,clinical.cos_retry_state from %I',role_name);
 end if; end loop;
end $$;
