-- Immutable note receipts remain the artifact history. This single receiver-owned
-- pointer models COS one-note-per-contact replacement, including patient correction.
create table clinical.cos_simulator_current (
 report_id uuid primary key references clinical.cos_simulator_contact(report_id) on delete cascade,
 delivery_id uuid not null unique references clinical.cos_simulator_note(delivery_id) on delete cascade,
 amendment_sequence integer not null check(amendment_sequence>=0),
 contact jsonb not null, contact_sha256 text not null,
 updated_at timestamptz not null default clock_timestamp()
);
insert into clinical.cos_simulator_current(report_id,delivery_id,amendment_sequence,contact,contact_sha256)
 select distinct on(n.report_id) n.report_id,n.delivery_id,d.amendment_sequence,p.contact,p.contact_sha256
 from clinical.cos_simulator_note n join clinical.cos_delivery d on d.id=n.delivery_id
 join clinical.cos_payload p on p.delivery_id=n.delivery_id
 order by n.report_id,d.amendment_sequence desc,n.created_at desc;
revoke all on clinical.cos_simulator_current from public,open_triage_api_runtime;
grant select,insert on clinical.cos_simulator_current to open_triage_api_runtime;
grant update(delivery_id,amendment_sequence,contact,contact_sha256,updated_at) on clinical.cos_simulator_current to open_triage_api_runtime;
create index cos_delivery_ordering on clinical.cos_delivery(report_id,amendment_sequence,state);
do $$ declare role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on clinical.cos_simulator_current from %I',role_name);
  end if;
 end loop;
end $$;
