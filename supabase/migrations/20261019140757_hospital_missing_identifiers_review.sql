-- Built-in operational conditions, independent of authored clinical rules.
create function clinical.review_cos_criterion_id(organization_id uuid, reason text)
returns uuid language sql immutable strict as $$
 select (substr(d,1,8)||'-'||substr(d,9,4)||'-4'||substr(d,14,3)||'-8'||substr(d,18,3)||'-'||substr(d,21,12))::uuid
 from (select md5('review-cos-identifiers:'||organization_id::text||':'||reason) d) h
$$;
revoke all on function clinical.review_cos_criterion_id(uuid,text) from public;
grant execute on function clinical.review_cos_criterion_id(uuid,text) to open_triage_api_runtime;
alter table clinical.review_item drop constraint review_item_kind_check,
 drop constraint review_overdue_context_check,
 add constraint review_item_kind_check check(kind in ('criterion','overdue-unsigned','missing-transmission-identifiers')),
 add constraint review_overdue_context_check check (
 (kind<>'overdue-unsigned' and deadline_basis_at is null and deadline_source is null and deadline_at is null and resolution_reason is null)
 or (kind='overdue-unsigned' and deadline_basis_at is not null and deadline_source is not null and deadline_at is not null));
alter table clinical.review_item add column transmission_reason text check(transmission_reason in ('patient-identity','integration-mapping')),
 add constraint review_transmission_context check((kind='missing-transmission-identifiers')=(transmission_reason is not null));
create table clinical.review_transmission_history (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null,
 report_id uuid not null references clinical.report(id) on delete cascade,
 item_id uuid not null,
 item_version bigint not null check(item_version>=0),
 delivery_id uuid not null references clinical.cos_delivery(id) on delete cascade,
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 active boolean not null,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(item_id,item_version),
 foreign key(organization_id,item_id) references clinical.review_item(organization_id,id) on delete cascade
);
create index review_transmission_report on clinical.review_transmission_history(report_id);
create index review_transmission_delivery on clinical.review_transmission_history(delivery_id);
create index review_transmission_agency_item on clinical.review_transmission_history(organization_id,item_id);
create trigger review_transmission_immutable before update or delete on clinical.review_transmission_history
 for each row execute function public.prevent_update_or_delete();
revoke all on clinical.review_transmission_history from public,open_triage_api_runtime;
grant select,insert on clinical.review_transmission_history to open_triage_api_runtime;
alter table clinical.review_transmission_history enable row level security;
create policy review_transmission_server on clinical.review_transmission_history to open_triage_api_runtime using(true) with check(true);
-- Also enforce the technical invariant underneath every API completion path.
create function clinical.guard_transmission_completion() returns trigger language plpgsql as $$
begin
 if new.kind='missing-transmission-identifiers' and new.active_match and new.status='completed' then
  raise exception 'Unresolved transmission requirements cannot be completed with a generic outcome';
 end if;
 return new;
end $$;
revoke all on function clinical.guard_transmission_completion() from public;
create trigger review_transmission_completion before insert or update on clinical.review_item
 for each row execute function clinical.guard_transmission_completion();
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
 if exists(select 1 from pg_roles where rolname=role_name) then
 execute format('revoke all on clinical.review_transmission_history from %I',role_name);
 end if; end loop;
end $$;
