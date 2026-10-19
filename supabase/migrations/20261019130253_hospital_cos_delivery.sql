-- Private API-owned delivery journal. Clinical copies share report retention.
create table clinical.cos_delivery (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references clinical.report(id) on delete cascade,
 snapshot_id uuid not null references clinical.signed_snapshot(id) on delete cascade,
 organization_id uuid not null references app_identity.organization(id),
 group_id uuid not null,
 configuration_revision bigint not null,
 mapping_id text not null, mapping_revision integer not null, mapping_sha256 text not null,
 pdf_language text not null check(pdf_language in ('en','sv')),
 amendment_sequence integer not null default 0 check(amendment_sequence>=0),
 lineage_parent_id uuid unique references clinical.cos_delivery(id) on delete cascade,
 command_id uuid unique,command_sha256 text,
 check((command_id is null)=(command_sha256 is null)),
 queued_by uuid not null references app_identity.app_user(id),
 state text not null default 'pending' check(state in ('pending','waiting','failed','uncertain','confirmed','excluded','superseded')),
 finding text, created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(id,report_id),
 foreign key(group_id,configuration_revision) references app_identity.hospital_cos_version(group_id,revision)
);
create unique index cos_delivery_signature on clinical.cos_delivery(snapshot_id,amendment_sequence) where lineage_parent_id is null;
create index cos_delivery_pending on clinical.cos_delivery(created_at,id) where state='pending';
create index cos_delivery_report on clinical.cos_delivery(report_id,created_at);
create index cos_delivery_organization on clinical.cos_delivery(organization_id);
create index cos_delivery_configuration on clinical.cos_delivery(group_id,configuration_revision);
create index cos_delivery_actor on clinical.cos_delivery(queued_by);
create index cos_delivery_lineage on clinical.cos_delivery(lineage_parent_id);
create table clinical.cos_payload (
 delivery_id uuid primary key references clinical.cos_delivery(id) on delete cascade,
 report_id uuid not null references clinical.report(id) on delete cascade,
 bundle jsonb not null, pdf bytea not null check(octet_length(pdf)<=10485760),
 payload_sha256 text not null, pdf_sha256 text not null,
 contact jsonb not null, contact_sha256 text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table clinical.cos_attempt (
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null references clinical.cos_delivery(id) on delete cascade,
 report_id uuid not null references clinical.report(id) on delete cascade,
 configuration_revision bigint not null, mapping_id text not null,mapping_revision integer not null,mapping_sha256 text not null,
 payload_sha256 text not null, pdf_sha256 text not null,
 worker_id uuid not null, created_at timestamptz not null default clock_timestamp()
);
create index cos_attempt_delivery on clinical.cos_attempt(delivery_id,created_at);
create table clinical.cos_delivery_event (
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null references clinical.cos_delivery(id) on delete cascade,
 report_id uuid not null references clinical.report(id) on delete cascade,
 attempt_id uuid references clinical.cos_attempt(id) on delete cascade,
 actor_id uuid references app_identity.app_user(id),worker_id uuid,
 state text not null, finding text, evidence jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp(),
 check ((actor_id is null) <> (worker_id is null))
);
create index cos_event_delivery on clinical.cos_delivery_event(delivery_id,created_at);
create index cos_event_attempt on clinical.cos_delivery_event(attempt_id);
create index cos_event_actor on clinical.cos_delivery_event(actor_id);
-- Explicit in-process development receiver, with independent committed storage.
-- Never represents a Cambio acknowledgement. No arbitrary remote network endpoint.
create table clinical.cos_simulator_contact (
 report_id uuid primary key references clinical.report(id) on delete cascade,
 contact_key text not null unique, content jsonb not null, content_sha256 text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table clinical.cos_simulator_note (
 delivery_id uuid primary key references clinical.cos_delivery(id) on delete cascade,
 report_id uuid not null references clinical.cos_simulator_contact(report_id) on delete cascade,
 bundle jsonb not null,pdf bytea not null, payload_sha256 text not null,pdf_sha256 text not null,
 receipt_id uuid not null unique default gen_random_uuid(),created_at timestamptz not null default clock_timestamp()
);
create index cos_simulator_note_report on clinical.cos_simulator_note(report_id);
-- Existing immutable clinical trigger permits only authorized retention/demo deletion.
create trigger cos_payload_immutable before update or delete on clinical.cos_payload for each row execute function public.prevent_update_or_delete();
create trigger cos_attempt_immutable before update or delete on clinical.cos_attempt for each row execute function public.prevent_update_or_delete();
create trigger cos_event_immutable before update or delete on clinical.cos_delivery_event for each row execute function public.prevent_update_or_delete();
create trigger cos_simulator_contact_immutable before update or delete on clinical.cos_simulator_contact for each row execute function public.prevent_update_or_delete();
create trigger cos_simulator_note_immutable before update or delete on clinical.cos_simulator_note for each row execute function public.prevent_update_or_delete();
revoke all on clinical.cos_delivery,clinical.cos_payload,clinical.cos_attempt,clinical.cos_delivery_event,clinical.cos_simulator_contact,clinical.cos_simulator_note from public,open_triage_api_runtime;
grant select,insert on clinical.cos_delivery,clinical.cos_payload,clinical.cos_attempt,clinical.cos_delivery_event,clinical.cos_simulator_contact,clinical.cos_simulator_note to open_triage_api_runtime;
grant update(state,finding,updated_at) on clinical.cos_delivery to open_triage_api_runtime;

alter table clinical.cos_payload add foreign key(delivery_id,report_id) references clinical.cos_delivery(id,report_id) on delete cascade;
alter table clinical.cos_attempt add foreign key(delivery_id,report_id) references clinical.cos_delivery(id,report_id) on delete cascade;
alter table clinical.cos_delivery_event add foreign key(delivery_id,report_id) references clinical.cos_delivery(id,report_id) on delete cascade;
create index cos_payload_report on clinical.cos_payload(report_id);
create index cos_attempt_report on clinical.cos_attempt(report_id);
create index cos_event_report on clinical.cos_delivery_event(report_id);

do $$ declare role_name text;
begin
 foreach role_name in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on clinical.cos_delivery,clinical.cos_payload,clinical.cos_attempt,clinical.cos_delivery_event,clinical.cos_simulator_contact,clinical.cos_simulator_note from %I',role_name);
  end if;
 end loop;
end $$;
