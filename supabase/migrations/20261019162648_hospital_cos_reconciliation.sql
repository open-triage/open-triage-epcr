-- Simulator candidate status contract only. Exact-attempt fences survive restarts.
-- Report deletion removes receiver rows too; a late writer then fails report FKs.
alter table clinical.cos_simulator_note add column operation_attempt_id uuid references clinical.cos_attempt(id) on delete cascade;
create index cos_simulator_note_attempt on clinical.cos_simulator_note(operation_attempt_id);
create table clinical.cos_simulator_fence (
 attempt_id uuid primary key references clinical.cos_attempt(id) on delete cascade,
 delivery_id uuid not null references clinical.cos_delivery(id) on delete cascade,
 report_id uuid not null references clinical.report(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp()
);
create index cos_simulator_fence_delivery on clinical.cos_simulator_fence(delivery_id);
create index cos_simulator_fence_report on clinical.cos_simulator_fence(report_id);
create table clinical.cos_reconciliation (
 id uuid primary key,
 command_sha256 text not null,
 report_id uuid not null references clinical.report(id) on delete cascade,
 item_id uuid not null references clinical.review_item(id) on delete cascade,
 delivery_id uuid not null references clinical.cos_delivery(id) on delete cascade,
 attempt_id uuid not null references clinical.cos_attempt(id) on delete cascade,
 actor_id uuid not null references app_identity.app_user(id),
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 outcome text not null check(outcome in ('stored','not-stored','unresolved','unsupported')),
 created_at timestamptz not null default clock_timestamp()
);
create index cos_reconciliation_report on clinical.cos_reconciliation(report_id);
create index cos_reconciliation_item on clinical.cos_reconciliation(item_id);
create index cos_reconciliation_delivery on clinical.cos_reconciliation(delivery_id);
create index cos_reconciliation_attempt on clinical.cos_reconciliation(attempt_id);
create index cos_reconciliation_actor on clinical.cos_reconciliation(actor_id);
create trigger cos_simulator_fence_immutable before update or delete on clinical.cos_simulator_fence for each row execute function public.prevent_update_or_delete();
create trigger cos_reconciliation_immutable before update or delete on clinical.cos_reconciliation for each row execute function public.prevent_update_or_delete();
revoke all on clinical.cos_simulator_fence,clinical.cos_reconciliation from public,open_triage_api_runtime;
grant select,insert on clinical.cos_simulator_fence,clinical.cos_reconciliation to open_triage_api_runtime;
alter table clinical.cos_simulator_fence enable row level security;
alter table clinical.cos_reconciliation enable row level security;
create policy cos_simulator_fence_server on clinical.cos_simulator_fence to open_triage_api_runtime using(true) with check(true);
create policy cos_reconciliation_server on clinical.cos_reconciliation to open_triage_api_runtime using(true) with check(true);
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
 if exists(select 1 from pg_roles where rolname=role_name) then
 execute format('revoke all on clinical.cos_simulator_fence,clinical.cos_reconciliation from %I',role_name);
 end if; end loop;
end $$;
