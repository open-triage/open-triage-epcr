-- Hospital integration baseline. This feature has not been deployed.
-- Apply after main; branch-era migration history is intentionally unsupported.
set local lock_timeout = '5s';

-- API-owned group configuration; no clinical copies or Data API exposure.
create table app_identity.hospital_eps_version (
  group_id uuid not null references app_identity.group_authentication_policy(group_id),
  revision bigint not null check (revision > 0),
  credential_id uuid not null,
  endpoint text not null,
  canonical_mapping jsonb not null check(jsonb_typeof(canonical_mapping)='object'),
  catalog_release_id uuid not null references catalog.release(id),
  form_version_id uuid not null references forms.form_version(id),
  encrypted_credential jsonb,
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  primary key(group_id,revision)
);
create table app_identity.hospital_eps_state (
  group_id uuid primary key references app_identity.group_authentication_policy(group_id),
  draft_revision bigint not null,
  active_revision bigint,
  state_revision bigint not null default 1,
  foreign key(group_id,draft_revision) references app_identity.hospital_eps_version(group_id,revision),
  foreign key(group_id,active_revision) references app_identity.hospital_eps_version(group_id,revision)
);
create table app_identity.hospital_eps_test (
  id uuid primary key,
  group_id uuid not null,
  revision bigint not null,
  result text not null check(result in ('healthy','failed')),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  foreign key(group_id,revision) references app_identity.hospital_eps_version(group_id,revision)
);
create index hospital_eps_test_revision on app_identity.hospital_eps_test(group_id,revision,created_at desc);
create index hospital_eps_test_actor on app_identity.hospital_eps_test(created_by);
create index hospital_eps_version_actor on app_identity.hospital_eps_version(created_by);
create index hospital_eps_version_catalog on app_identity.hospital_eps_version(catalog_release_id);
create index hospital_eps_version_form on app_identity.hospital_eps_version(form_version_id);
revoke all on app_identity.hospital_eps_version,app_identity.hospital_eps_state,app_identity.hospital_eps_test from public,open_triage_api_runtime;
grant select,insert on app_identity.hospital_eps_version,app_identity.hospital_eps_test to open_triage_api_runtime;
grant select,insert,update on app_identity.hospital_eps_state to open_triage_api_runtime;
alter table app_identity.configuration_event drop constraint configuration_event_action_check,
 add constraint configuration_event_action_check check(action in (
 'catalog.draft_delete','form.draft_create','form.draft_save','form.draft_delete','form.publish','form.activate','configuration.activate',
 'hospital.draft_save','hospital.test','hospital.activate','hospital.deactivate','hospital.credential_replace','hospital.resume'
 ));
create trigger hospital_eps_version_append_only before update or delete on app_identity.hospital_eps_version
  for each row execute function public.prevent_update_or_delete();
create trigger hospital_eps_test_append_only before update or delete on app_identity.hospital_eps_test
  for each row execute function public.prevent_update_or_delete();

do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on app_identity.hospital_eps_version,app_identity.hospital_eps_state,app_identity.hospital_eps_test from %I',role_name);
    end if;
  end loop;
end $$;

-- API-owned group configuration; no clinical copies or Data API exposure.
create table app_identity.hospital_cos_version (
  group_id uuid not null references app_identity.group_authentication_policy(group_id),
  revision bigint not null check (revision > 0),
  credential_id uuid not null,
  endpoint text not null,
  settings jsonb not null check(jsonb_typeof(settings)='object'),
  canonical_mapping jsonb not null check(jsonb_typeof(canonical_mapping)='object'),
  catalog_release_id uuid not null references catalog.release(id),
  form_version_id uuid not null references forms.form_version(id),
  encrypted_credential jsonb,
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(group_id,revision)
);
create table app_identity.hospital_cos_state (
  group_id uuid primary key references app_identity.group_authentication_policy(group_id),
  draft_revision bigint not null,
  active_revision bigint,
  state_revision bigint not null default 1,
  foreign key(group_id,draft_revision) references app_identity.hospital_cos_version(group_id,revision),
  foreign key(group_id,active_revision) references app_identity.hospital_cos_version(group_id,revision)
);
create table app_identity.hospital_cos_test (
  id uuid primary key,
  group_id uuid not null,
  revision bigint not null,
  result text not null check(result in ('healthy','failed')),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(group_id,revision) references app_identity.hospital_cos_version(group_id,revision)
);
create index hospital_cos_test_revision on app_identity.hospital_cos_test(group_id,revision,created_at desc);
create index hospital_cos_test_actor on app_identity.hospital_cos_test(created_by);
create index hospital_cos_version_actor on app_identity.hospital_cos_version(created_by);
create index hospital_cos_version_catalog on app_identity.hospital_cos_version(catalog_release_id);
create index hospital_cos_version_form on app_identity.hospital_cos_version(form_version_id);
revoke all on app_identity.hospital_cos_version,app_identity.hospital_cos_state,app_identity.hospital_cos_test from public,open_triage_api_runtime;
grant select,insert on app_identity.hospital_cos_version,app_identity.hospital_cos_test to open_triage_api_runtime;
grant select,insert,update on app_identity.hospital_cos_state to open_triage_api_runtime;
create trigger hospital_cos_version_append_only before update or delete on app_identity.hospital_cos_version
  for each row execute function public.prevent_update_or_delete();
create trigger hospital_cos_test_append_only before update or delete on app_identity.hospital_cos_test
  for each row execute function public.prevent_update_or_delete();

do $$
declare role_name text;
begin
  foreach role_name in array array['anon','authenticated'] loop
    if exists(select 1 from pg_roles where rolname=role_name) then
      execute format('revoke all on app_identity.hospital_cos_version,app_identity.hospital_cos_state,app_identity.hospital_cos_test from %I',role_name);
    end if;
  end loop;
end $$;

-- Evidence ordering is completion order, including concurrent requests serialized
-- by the group lock. Transaction-start timestamps can put an older result last.
alter table app_identity.hospital_eps_test alter column created_at set default clock_timestamp();

alter table clinical_audit.patient_access_event drop constraint patient_access_event_action_check;
alter table clinical_audit.patient_access_event add constraint patient_access_event_action_check check(action in (
 'report.read','report.reopen','report.active','report.list','assignment.open','review.report','review.overdue','photo.read','audio.read',
 'analytics.query','analytics.export.aggregate','analytics.export.records','audit.clinical-values','eps.read','eps.import','eps.export','eps.submit'
));

alter table clinical_audit.patient_access_event add column integration_provenance jsonb;
alter table clinical_audit.patient_access_event add constraint patient_access_eps_provenance_check check(
 (action in ('eps.read','eps.import','eps.export','eps.submit') and integration_provenance is not null and jsonb_typeof(integration_provenance)='object'
  and integration_provenance ?& array['configurationRevision','mappingId','mappingRevision','mappingSha256'])
 or(action not in ('eps.read','eps.import','eps.export','eps.submit') and integration_provenance is null)
);
grant insert (integration_provenance) on clinical_audit.patient_access_event to open_triage_api_runtime;
comment on column clinical_audit.patient_access_event.integration_provenance is
  'Immutable EPS configuration and canonical mapping revision. No patient identifiers or clinical payloads.';

-- Protected report-owned evidence follows report deletion and synthetic expiry.
create table clinical.eps_import_plan (
 id uuid primary key, report_id uuid not null references clinical.report(id) on delete cascade,
 author_id uuid not null, revision bigint not null, binding text not null,
 source_key text not null, evidence jsonb not null, created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '15 minutes'
);
create index eps_import_plan_report_idx on clinical.eps_import_plan(report_id);
create index eps_import_plan_expiry_idx on clinical.eps_import_plan(expires_at);
create table clinical.eps_import (
 id uuid primary key, report_id uuid not null references clinical.report(id) on delete cascade,
 source_key text not null, occurrence_id uuid, decision text not null check(decision in ('import','keep','replace','append')),
 command_id uuid not null unique, command_sha256 text not null, evidence jsonb not null,
 author_id uuid not null, created_at timestamptz not null default clock_timestamp(),
 unique(report_id,source_key)
);
create index eps_import_occurrence_idx on clinical.eps_import(occurrence_id);
alter table clinical.eps_import_plan enable row level security;
alter table clinical.eps_import enable row level security;
revoke all on clinical.eps_import_plan,clinical.eps_import from public;
grant select,insert,delete on clinical.eps_import_plan to open_triage_api_runtime;
grant select,insert on clinical.eps_import to open_triage_api_runtime;
-- The API runtime is the existing trusted clinical-service boundary; browser roles
-- receive no grants/policies. It authorizes the live clinician and report before SQL.
create policy eps_import_plan_runtime on clinical.eps_import_plan to open_triage_api_runtime using(true) with check(true);
create policy eps_import_runtime on clinical.eps_import to open_triage_api_runtime using(true) with check(true);
comment on table clinical.eps_import is 'Immutable selected-source lineage and deliberate decisions; cascades with report retention.';

create trigger eps_import_immutable before update on clinical.eps_import
for each row execute function public.prevent_update_or_delete();
do $$ declare browser_role text; begin
 foreach browser_role in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=browser_role) then
   execute format('revoke all on clinical.eps_import_plan,clinical.eps_import from %I',browser_role);
  end if;
 end loop;
end $$;

-- A clinician's request to sign is durable, but is not a signed clinical snapshot.
create table clinical.signing_submission (
 id uuid primary key,
 report_id uuid not null references clinical.report(id) on delete cascade,
 revision bigint not null check(revision>=0),
 command_id uuid not null unique,
 command_sha256 text not null,
 prepared jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(id,report_id)
);
create index signing_submission_report on clinical.signing_submission(report_id,created_at desc,id);
create trigger signing_submission_immutable before update or delete on clinical.signing_submission
 for each row execute function public.prevent_update_or_delete();
alter table clinical.signing_submission enable row level security;
revoke all on clinical.signing_submission from public,open_triage_api_runtime;
grant select,insert on clinical.signing_submission to open_triage_api_runtime;
create policy signing_submission_runtime on clinical.signing_submission to open_triage_api_runtime using(true) with check(true);

-- Private API-owned delivery journal. Clinical copies share report retention.
create table clinical.cos_delivery (
 id uuid primary key default gen_random_uuid(),
 report_id uuid not null references clinical.report(id) on delete cascade,
 snapshot_id uuid references clinical.signed_snapshot(id) on delete cascade,
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
 foreign key(group_id,configuration_revision) references app_identity.hospital_cos_version(group_id,revision),
 signing_submission_id uuid
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

-- Immutable note receipts remain the artifact history. This single receiver-owned
-- pointer models COS one-note-per-contact replacement, including patient correction.
create table clinical.cos_simulator_current (
 report_id uuid primary key references clinical.cos_simulator_contact(report_id) on delete cascade,
 delivery_id uuid not null unique references clinical.cos_simulator_note(delivery_id) on delete cascade,
 amendment_sequence integer not null check(amendment_sequence>=0),
 contact jsonb not null, contact_sha256 text not null,
 updated_at timestamptz not null default clock_timestamp()
);

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
create function clinical.guard_transmission_completion() returns trigger language plpgsql as $$
begin
 if new.kind='eps-export' and new.active_match and new.status='completed' then
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

-- Private, report-retained immutable prepared documents and append-only publication evidence.
create table clinical.eps_submission (
 id uuid primary key, report_id uuid not null references clinical.report(id) on delete cascade,
 snapshot_id uuid references clinical.signed_snapshot(id) on delete cascade,
 amendment_sequence integer not null check(amendment_sequence>=0),
 organization_id uuid not null references app_identity.organization(id),group_id uuid not null,
 configuration_revision bigint not null,mapping_id text not null,mapping_revision integer not null,mapping_sha256 text not null,
 destination text not null,bundle jsonb not null,validation jsonb not null,payload_sha256 text not null,
 source_sha256 text not null,amendment_hashes jsonb not null,
 lineage_parent_id uuid references clinical.eps_submission(id) on delete cascade,
 prepared_by uuid not null references app_identity.app_user(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(group_id,configuration_revision) references app_identity.hospital_eps_version(group_id,revision),
 unique(id,report_id),
 signing_submission_id uuid
);
create index eps_submission_report on clinical.eps_submission(report_id,created_at);
create index eps_submission_snapshot on clinical.eps_submission(snapshot_id);
create index eps_submission_organization on clinical.eps_submission(organization_id);
create index eps_submission_configuration on clinical.eps_submission(group_id,configuration_revision);
create index eps_submission_actor on clinical.eps_submission(prepared_by);
create index eps_submission_lineage on clinical.eps_submission(lineage_parent_id);
create table clinical.eps_submission_attempt (
 id uuid primary key, submission_id uuid not null unique,
 command_id uuid not null unique,actor_id uuid not null references app_identity.app_user(id),
 created_at timestamptz not null default clock_timestamp(),
 report_id uuid not null,
 unique(id,report_id),
 foreign key(submission_id,report_id) references clinical.eps_submission(id,report_id) on delete cascade
);
create index eps_submission_attempt_actor on clinical.eps_submission_attempt(actor_id);
create table clinical.eps_submission_result (
 attempt_id uuid primary key,
 state text not null check(state in ('accepted','rejected','unknown')), evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 report_id uuid not null,
 foreign key(attempt_id,report_id) references clinical.eps_submission_attempt(id,report_id) on delete cascade
);
create trigger eps_submission_immutable before update or delete on clinical.eps_submission for each row execute function public.prevent_update_or_delete();
create trigger eps_submission_attempt_immutable before update or delete on clinical.eps_submission_attempt for each row execute function public.prevent_update_or_delete();
create trigger eps_submission_result_immutable before update or delete on clinical.eps_submission_result for each row execute function public.prevent_update_or_delete();
revoke all on clinical.eps_submission,clinical.eps_submission_attempt,clinical.eps_submission_result from public,open_triage_api_runtime;
grant select,insert on clinical.eps_submission,clinical.eps_submission_attempt,clinical.eps_submission_result to open_triage_api_runtime;
do $$ declare role_name text;begin foreach role_name in array array['anon','authenticated'] loop if exists(select 1 from pg_roles where rolname=role_name) then execute format('revoke all on clinical.eps_submission,clinical.eps_submission_attempt,clinical.eps_submission_result from %I',role_name);end if;end loop;end $$;

alter table clinical.eps_submission enable row level security;
alter table clinical.eps_submission_attempt enable row level security;
alter table clinical.eps_submission_result enable row level security;
create policy eps_submission_runtime on clinical.eps_submission to open_triage_api_runtime using(true) with check(true);
create policy eps_submission_attempt_runtime on clinical.eps_submission_attempt to open_triage_api_runtime using(true) with check(true);
create policy eps_submission_result_runtime on clinical.eps_submission_result to open_triage_api_runtime using(true) with check(true);

alter table clinical_audit.patient_access_event drop constraint patient_access_event_resource_check;
alter table clinical_audit.patient_access_event add constraint patient_access_event_resource_check check(
 (action in ('photo.read','audio.read','analytics.query','analytics.export.aggregate','analytics.export.records','eps.export','eps.submit'))=(resource_id is not null)
);

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
 outcome text not null check(outcome in ('stored','accepted','not-stored','unresolved','unsupported')),
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

create index hospital_cos_credential_predecessor on app_identity.hospital_cos_credential_lineage(group_id,predecessor_revision);
create index hospital_cos_credential_test on app_identity.hospital_cos_credential_lineage(test_id);
create index hospital_cos_credential_actor on app_identity.hospital_cos_credential_lineage(actor_id);

-- Only nonclinical metadata survives report/payload retention. No FK to clinical copies.
create table clinical_audit.hospital_operational_event (
 id uuid primary key, organization_id uuid not null,report_id uuid not null,
 integration text not null check(integration in ('eps','cos')),verification text not null check(verification in ('simulator','unverified','eps')),source_id uuid not null,
 snapshot_id uuid,amendment_sequence integer not null,synthetic boolean not null,
 configuration_revision bigint not null,mapping_id text not null,mapping_revision integer not null,
 mapping_sha256 text not null check(mapping_sha256 ~ '^[0-9a-f]{64}$'),
 payload_sha256 text check(payload_sha256 ~ '^[0-9a-f]{64}$'),
 actor_id uuid,worker_id uuid,action text not null,state text not null,
 attempt_id uuid,command_id uuid, finding text check(finding in ('outage','outcomeUnknown','inFlight','contactStored','reconciledNotStored','reconciliationUnresolved','reconciliationUnsupported')),remote_pass boolean,remote_errors integer,proof_outcome text check(proof_outcome in ('stored','not-stored','unresolved','unsupported')),proof_fenced boolean,
 receipt_id uuid,occurred_at timestamptz not null,
 check(actor_id is null or worker_id is null),
 signing_submission_id uuid,
 verification_details jsonb,
 constraint hospital_operational_source check(snapshot_id is not null or signing_submission_id is not null),
 constraint hospital_verification_details_object check(verification_details is null or jsonb_typeof(verification_details)='object')
);
create index hospital_operational_scope on clinical_audit.hospital_operational_event(organization_id,occurred_at desc,id);
create index hospital_operational_report on clinical_audit.hospital_operational_event(report_id);
create trigger hospital_operational_immutable before update or delete or truncate on clinical_audit.hospital_operational_event for each statement execute function clinical_audit.reject_patient_access_change();
alter table clinical_audit.hospital_operational_event enable row level security;
create policy hospital_operational_append on clinical_audit.hospital_operational_event for insert to open_triage_api_runtime with check(true);
create policy hospital_operational_audit on clinical_audit.hospital_operational_event for select to open_triage_api_runtime using(organization_id=nullif(current_setting('open_triage.audit_organization_id',true),'')::uuid);
revoke all on clinical_audit.hospital_operational_event from public,open_triage_api_runtime;
grant select,insert on clinical_audit.hospital_operational_event to open_triage_api_runtime;
-- Invoker function runs under the ordinary trusted API writer. No new elevated role.
create function clinical_audit.record_hospital_operational_event() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='cos_delivery_event' then
  insert into clinical_audit.hospital_operational_event(id,organization_id,report_id,integration,verification,source_id,snapshot_id,signing_submission_id,amendment_sequence,synthetic,configuration_revision,mapping_id,mapping_revision,mapping_sha256,payload_sha256,actor_id,worker_id,action,state,receipt_id,attempt_id,command_id,finding,proof_outcome,proof_fenced,occurred_at,verification_details)
   select new.id,d.organization_id,d.report_id,'cos',case when (select v.settings->>'mode' from app_identity.hospital_cos_version v where v.group_id=d.group_id and v.revision=d.configuration_revision)='simulator' then 'simulator' else 'unverified' end,d.id,d.snapshot_id,d.signing_submission_id,d.amendment_sequence,r.synthetic,d.configuration_revision,d.mapping_id,d.mapping_revision,d.mapping_sha256,p.payload_sha256,new.actor_id,new.worker_id,case when new.evidence->>'action'='reconcile' then 'cos.reconcile' when c.automatic_ordinal is not null then 'cos.automatic-retry' when c.id is not null then 'cos.manual-retry' else 'cos.delivery' end,new.state,
    case when new.evidence->>'receiptId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.evidence->>'receiptId')::uuid end,new.attempt_id,case when new.evidence->>'action'='reconcile' and new.evidence->>'commandId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.evidence->>'commandId')::uuid else a.recovery_command_id end,case when new.finding in ('outage','outcomeUnknown','inFlight','contactStored','reconciledNotStored','reconciliationUnresolved','reconciliationUnsupported') then new.finding end,case when new.evidence->>'outcome' in ('stored','not-stored','unresolved','unsupported') then new.evidence->>'outcome' end,case when jsonb_typeof(new.evidence->'fenced')='boolean' then (new.evidence->>'fenced')::boolean end,new.created_at,case when new.evidence->>'outcome'='accepted' then jsonb_build_object('verificationOutcome','accepted','readBackVerification',false) end
   from clinical.cos_delivery d join clinical.report r on r.id=d.report_id left join clinical.cos_payload p on p.delivery_id=d.id left join clinical.cos_attempt a on a.id=new.attempt_id left join clinical.cos_recovery_command c on c.id=a.recovery_command_id where d.id=new.delivery_id;
 elsif tg_table_name='eps_submission_attempt' then
  insert into clinical_audit.hospital_operational_event(id,organization_id,report_id,integration,verification,source_id,snapshot_id,signing_submission_id,amendment_sequence,synthetic,configuration_revision,mapping_id,mapping_revision,mapping_sha256,payload_sha256,actor_id,action,state,occurred_at)
   select new.id,s.organization_id,s.report_id,'eps','eps',s.id,s.snapshot_id,s.signing_submission_id,s.amendment_sequence,r.synthetic,s.configuration_revision,s.mapping_id,s.mapping_revision,s.mapping_sha256,s.payload_sha256,new.actor_id,'eps.submit','unknown',new.created_at from clinical.eps_submission s join clinical.report r on r.id=s.report_id where s.id=new.submission_id;
 else
  insert into clinical_audit.hospital_operational_event(id,organization_id,report_id,integration,verification,source_id,snapshot_id,signing_submission_id,amendment_sequence,synthetic,configuration_revision,mapping_id,mapping_revision,mapping_sha256,payload_sha256,actor_id,action,state,attempt_id,command_id,remote_pass,remote_errors,occurred_at)
   select gen_random_uuid(),s.organization_id,s.report_id,'eps','eps',s.id,s.snapshot_id,s.signing_submission_id,s.amendment_sequence,r.synthetic,s.configuration_revision,s.mapping_id,s.mapping_revision,s.mapping_sha256,s.payload_sha256,a.actor_id,'eps.result',new.state,a.id,a.command_id,case when new.evidence->'headers'->>'x-pass' in ('true','false') then (new.evidence->'headers'->>'x-pass')::boolean end,case when new.evidence->'headers'->>'x-errors' ~ '^\d{1,6}$' then (new.evidence->'headers'->>'x-errors')::integer end,new.created_at from clinical.eps_submission_attempt a join clinical.eps_submission s on s.id=a.submission_id join clinical.report r on r.id=s.report_id where a.id=new.attempt_id;
 end if;
 return new;
end $$;
revoke all on function clinical_audit.record_hospital_operational_event() from public;
grant execute on function clinical_audit.record_hospital_operational_event() to open_triage_api_runtime;
create trigger cos_operational_audit after insert on clinical.cos_delivery_event for each row execute function clinical_audit.record_hospital_operational_event();
create trigger eps_attempt_operational_audit after insert on clinical.eps_submission_attempt for each row execute function clinical_audit.record_hospital_operational_event();
create trigger eps_result_operational_audit after insert on clinical.eps_submission_result for each row execute function clinical_audit.record_hospital_operational_event();
-- The unresolved item is committed with the signature, before any browser/network export.
alter table clinical.review_item
 drop constraint review_item_kind_check,
 add constraint review_item_kind_check check(kind in ('criterion','overdue-unsigned','missing-transmission-identifiers','cos-delivery-failed','eps-export')),
 add column eps_snapshot_id uuid references clinical.signed_snapshot(id) on delete cascade,
 add column eps_amendment_sequence integer,
 add constraint review_eps_sequence check(case when kind='eps-export' then eps_amendment_sequence is not null and eps_amendment_sequence>=0 else eps_amendment_sequence is null end),
 add constraint review_eps_context check((kind='eps-export')=(eps_snapshot_id is not null));
create index review_item_eps_snapshot on clinical.review_item(eps_snapshot_id) where eps_snapshot_id is not null;

-- Reopening protected reports uses the existing authenticated session.
-- Preserve ownership, capability, session validity, expiry, single-use grants,
-- audit events, and existing private function owners and ACLs.

create or replace function offline_recovery.create_report_recovery_grant(
  candidate_report_id uuid,
  candidate_organization_id uuid,
  candidate_user_id uuid,
  candidate_session_token_sha256 text,
  candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (result text, recovery_handle uuid, grant_id uuid,
  expires_at timestamptz, report_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_session app_identity.app_session%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  selected_reason text;
  selected_grant_id uuid;
  selected_expires_at timestamptz;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.lock_recovery_authority(candidate_report_id, candidate_organization_id, candidate_user_id, candidate_session_token_sha256);
  selected_now := clock_timestamp();
  select session.* into selected_session
  from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and session.organization_id = candidate_organization_id
    and app_identity.user_can_access_organization(app_user.id, candidate_organization_id)
    and app_user.active and session.revoked_at is null
    and session.expires_at > selected_now
    and app_identity.session_authentication_valid(session);

  if selected_session.id is null or not app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document'
  ) then selected_reason := 'unauthorized';
  elsif exists (select 1 from offline_recovery.report_purge_tombstone
    where report_id = candidate_report_id) then selected_reason := 'purged';
  else
    select report.* into selected_report from clinical.report report
      where report.id = candidate_report_id;
    if selected_report.id is null then selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
    else
      select envelope.* into selected_envelope
      from offline_recovery.report_key_envelope envelope
      where envelope.report_id = candidate_report_id;
      if selected_envelope.report_id is null or selected_envelope.envelope_version <> candidate_envelope_version then selected_reason := 'missing';
      elsif selected_envelope.organization_id <> candidate_organization_id or selected_envelope.owner_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
      elsif selected_envelope.state = 'purged' then selected_reason := 'purged';
      elsif selected_envelope.state = 'expired' or selected_envelope.recovery_deadline <= selected_now then selected_reason := 'expired';
      elsif selected_report.status = 'draft'
        and selected_envelope.state not in ('live', 'locked') then selected_reason := 'unauthorized';
      elsif selected_report.status = 'signed'
        and selected_envelope.state <> 'completed' then selected_reason := 'ineligible_state';
      elsif selected_report.status not in ('draft', 'signed')
        or selected_envelope.wrapping_nonce is null
        or selected_envelope.wrapped_data_key is null then selected_reason := 'ineligible_state';
      end if;
    end if;
  end if;

  if selected_reason is not null then
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, action, outcome, reason)
    values (candidate_organization_id, candidate_user_id, candidate_report_id,
      selected_session.id, 'grant', 'denied', selected_reason);
    return query select 'denied'::text,
      null::uuid, null::uuid, null::timestamptz, null::text;
    return;
  end if;

  -- Restored authority makes the envelope eligible again, but never changes
  -- its fixed recovery deadline or exposes key material.
  update offline_recovery.report_key_envelope envelope
  set state = 'live', updated_at = selected_now
  where envelope.report_id = candidate_report_id
    and envelope.organization_id = candidate_organization_id
    and envelope.owner_user_id = candidate_user_id
    and envelope.state = 'locked'
    and envelope.recovery_deadline > selected_now;

  insert into offline_recovery.report_recovery_grant
    (token_sha256, session_id, user_id, organization_id, report_id,
     envelope_version, required_capability, owner_user_id,
     eligible_report_state, created_at, expires_at)
  values (candidate_grant_token_sha256, selected_session.id,
    candidate_user_id, candidate_organization_id, candidate_report_id,
    candidate_envelope_version, 'clinical:document', candidate_user_id,
    selected_report.status, selected_now, least(selected_now + interval '60 seconds', selected_session.expires_at, selected_envelope.recovery_deadline))
  returning id, report_recovery_grant.expires_at
    into selected_grant_id, selected_expires_at;

  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id,
     action, outcome, reason)
  values (candidate_organization_id, candidate_user_id, candidate_report_id,
    selected_session.id, selected_grant_id, 'grant', 'succeeded', 'allowed');
  return query select 'created'::text, selected_envelope.recovery_handle,
    selected_grant_id, selected_expires_at, selected_report.status;
end;
$$;

create or replace function offline_recovery.consume_report_recovery_grant(
  candidate_report_id uuid, candidate_organization_id uuid, candidate_user_id uuid,
  candidate_session_token_sha256 text, candidate_grant_token_sha256 text,
  candidate_envelope_version integer
)
returns table (result text, recovery_handle uuid, wrapping_key_version integer,
  wrapping_nonce bytea, wrapped_data_key bytea)
language plpgsql security definer set search_path = '' as $$
declare selected_session app_identity.app_session%rowtype;
  selected_grant offline_recovery.report_recovery_grant%rowtype;
  selected_report clinical.report%rowtype;
  selected_envelope offline_recovery.report_key_envelope%rowtype;
  released_key record; selected_reason text;
  selected_now timestamptz := clock_timestamp();
begin
  perform offline_recovery.lock_recovery_authority(candidate_report_id, candidate_organization_id, candidate_user_id, candidate_session_token_sha256);
  selected_now := clock_timestamp();
  select session.* into selected_session from app_identity.app_session session
  join app_identity.app_user app_user on app_user.id = session.user_id
  where session.token_sha256 = candidate_session_token_sha256
    and session.user_id = candidate_user_id
    and session.organization_id = candidate_organization_id
    and app_identity.user_can_access_organization(app_user.id, candidate_organization_id) and app_user.active
    and session.revoked_at is null and session.expires_at > selected_now
    and app_identity.session_authentication_valid(session);
  select * into selected_grant from offline_recovery.report_recovery_grant
  where token_sha256 = candidate_grant_token_sha256 for update;
  if selected_session.id is null then selected_reason := 'unauthorized';
  elsif selected_grant.id is null then selected_reason := 'missing';
  elsif selected_grant.consumed_at is not null then selected_reason := 'replayed';
  elsif selected_grant.expires_at <= selected_now then selected_reason := 'grant_expired';
  elsif selected_grant.session_id <> selected_session.id or selected_grant.user_id <> candidate_user_id
    or selected_grant.organization_id <> candidate_organization_id
    or selected_grant.report_id <> candidate_report_id
    or selected_grant.envelope_version <> candidate_envelope_version
    or selected_grant.owner_user_id <> candidate_user_id
    or selected_grant.required_capability <> 'clinical:document' then selected_reason := 'binding_mismatch';
  elsif exists (select 1 from offline_recovery.report_purge_tombstone where report_id = candidate_report_id) then
    selected_reason := 'purged';
  end if;
  if selected_reason is null and not app_identity.user_has_capability(
    candidate_user_id, candidate_organization_id, 'clinical:document') then selected_reason := 'unauthorized';
  elsif selected_reason is null then
    select * into selected_report from clinical.report where id = candidate_report_id;
    select * into selected_envelope from offline_recovery.report_key_envelope where report_id = candidate_report_id;
    if selected_report.id is null or selected_envelope.report_id is null then selected_reason := 'missing';
    elsif selected_report.organization_id <> candidate_organization_id then selected_reason := 'unauthorized';
    elsif selected_report.documenting_user_id <> candidate_user_id then selected_reason := 'wrong_owner';
    elsif selected_report.status <> selected_grant.eligible_report_state then selected_reason := 'ineligible_state';
    elsif selected_report.status = 'draft' and selected_envelope.state <> 'live' then selected_reason := 'unauthorized';
    elsif selected_report.status = 'signed' and selected_envelope.state <> 'completed' then
      selected_reason := 'ineligible_state';
    end if;
  end if;
  if selected_reason is null then
    select * into released_key from offline_recovery.recover_report_key(
      candidate_report_id, candidate_organization_id, candidate_user_id,
      selected_envelope.recovery_handle);
    if not found then selected_reason := 'expired'; end if;
  end if;
  if selected_reason is not null then
    insert into offline_recovery.report_recovery_event
      (organization_id, user_id, report_id, session_id, grant_id, action, outcome, reason)
    values (candidate_organization_id, candidate_user_id, candidate_report_id,
      selected_session.id, selected_grant.id, 'consume', 'denied', selected_reason);
    return query select 'denied'::text, null::uuid, null::integer, null::bytea, null::bytea;
    return;
  end if;
  update offline_recovery.report_recovery_grant set consumed_at = selected_now
  where id = selected_grant.id and consumed_at is null;
  insert into offline_recovery.report_recovery_event
    (organization_id, user_id, report_id, session_id, grant_id, action, outcome, reason)
  values (candidate_organization_id, candidate_user_id, candidate_report_id,
    selected_session.id, selected_grant.id, 'consume', 'succeeded', 'allowed');
  return query select 'consumed'::text, selected_envelope.recovery_handle,
    released_key.wrapping_key_version::integer,
    released_key.wrapping_nonce::bytea, released_key.wrapped_data_key::bytea;
end;
$$;

-- Keep audit inspection evidence compatible with the shared category catalog.
alter table clinical_audit.audit_read_event
  drop constraint audit_read_event_category_check,
  add constraint audit_read_event_category_check check (category in (
    'patient','authentication','authorization','configuration','clinical','media','recovery',
    'review','synthetic','installations','feedback','audit','analytics','integrations','combined')),
  drop constraint audit_read_event_queried_categories_check,
  add constraint audit_read_event_queried_categories_check check (
    (category <> 'combined' or (queried_categories is not null and cardinality(queried_categories) > 1))
    and (queried_categories is null or (
      inspection_kind = 'list'
      and cardinality(queried_categories) between 1 and 14
      and array_ndims(queried_categories) = 1
      and array_position(queried_categories, null) is null
      and queried_categories <@ array['patient','authentication','authorization','configuration','clinical',
        'media','recovery','review','synthetic','installations','feedback','audit','analytics','integrations']::text[]
      and (category = 'combined' or queried_categories = array[category])
    ))
  );

-- These existing ledgers were omitted from the original audit source catalog.
-- Give their rows stable public identifiers without exposing protected payloads.
do $$ declare source_name text;
begin
  foreach source_name in array array[
    'clinical_audit.post_signature_dispatch_delivery', 'clinical_audit.synthetic_purge_tombstone'
  ] loop
    execute format('alter table %s add column audit_id uuid not null default gen_random_uuid() unique', source_name::regclass);
    execute format('create trigger audit_id_immutable before update of audit_id on %s for each row execute function clinical_audit.reject_audit_id_change()', source_name::regclass);
  end loop;
end $$;
grant select (audit_id,report_id,dispatch_receipt_id,event_type,created_at)
  on clinical_audit.post_signature_dispatch_delivery to open_triage_api_runtime;
grant select (audit_id,record_id,record_type,organization_id,purged_at)
  on clinical_audit.synthetic_purge_tombstone to open_triage_api_runtime;

-- Authoritative identifiers remain optional for local authentication and signing.
alter table app_identity.app_user
 add column hsa_id text check (hsa_id is null or (length(hsa_id) between 1 and 128 and hsa_id !~ '[[:cntrl:]]')),
 add column hsa_source text check (hsa_source in ('manual','oidc')),
 add column hsa_conflict boolean not null default false;
alter table app_identity.operational_unit add column rakel_id text
 check (rakel_id is null or (length(rakel_id) between 1 and 128 and rakel_id !~ '[[:cntrl:]]'));
-- Serialize assignment across all agencies in a group, including inactive users.
create function app_identity.validate_hsa_assignment() returns trigger language plpgsql set search_path='' as $$
begin
 if new.hsa_id is not null then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(app_identity.organization_group(new.organization_id)::text || ':' || new.hsa_id, 76211));
  if exists(select 1 from app_identity.app_user u where u.id<>new.id and u.hsa_id=new.hsa_id
   and app_identity.organization_group(u.organization_id)=app_identity.organization_group(new.organization_id)) then
   raise unique_violation using message='HSA already assigned in agency group';
  end if;
 end if;
 return new;
end $$;
revoke all on function app_identity.validate_hsa_assignment() from public;
create trigger app_user_hsa_unique before insert or update of hsa_id,organization_id on app_identity.app_user
 for each row execute function app_identity.validate_hsa_assignment();
create unique index operational_unit_rakel_unique on app_identity.operational_unit(organization_id,rakel_id) where rakel_id is not null;
create index app_user_hsa_lookup on app_identity.app_user(hsa_id) where hsa_id is not null;
grant update(hsa_id,hsa_source,hsa_conflict) on app_identity.app_user to open_triage_api_runtime;
grant update(rakel_id) on app_identity.operational_unit to open_triage_api_runtime;

create table app_identity.destination_directory (
 group_id uuid not null references app_identity.organization(id),
 id uuid not null default gen_random_uuid(),
 local_code text not null check(length(local_code) between 2 and 50 and local_code !~ '[[:cntrl:]]'),
 display_name text not null check(length(display_name) between 2 and 100 and display_name !~ '[[:cntrl:]]'),
 hsa_id text check(hsa_id is null or (length(hsa_id) between 1 and 128 and hsa_id !~ '[[:cntrl:]]')),
 active boolean not null default true,
 revision integer not null default 1 check(revision>0),
 primary key(group_id,id), unique(group_id,local_code)
);
create index destination_directory_search on app_identity.destination_directory(group_id,active,lower(display_name),id);
create table app_identity.destination_revision (
 group_id uuid not null, destination_id uuid not null, revision integer not null check(revision>0),
 local_code text not null, display_name text not null, hsa_id text, active boolean not null,
 actor_id uuid not null references app_identity.app_user(id), occurred_at timestamptz not null default now(),
 primary key(group_id,destination_id,revision),
 foreign key(group_id,destination_id) references app_identity.destination_directory(group_id,id)
);
create index destination_revision_actor on app_identity.destination_revision(actor_id);
create trigger destination_revision_append_only before update or delete on app_identity.destination_revision
 for each row execute function public.prevent_update_or_delete();
revoke all on app_identity.destination_directory,app_identity.destination_revision from public;
grant select,insert,update on app_identity.destination_directory to open_triage_api_runtime;
grant select,insert on app_identity.destination_revision to open_triage_api_runtime;

-- Capture the operational unit when the report becomes signed; later assignment
-- changes and workstation selection cannot alter attribution.
alter table clinical.report add column cos_unit_id uuid;
alter table clinical.report add foreign key(organization_id,cos_unit_id) references app_identity.operational_unit(organization_id,id);
create index report_cos_unit on clinical.report(organization_id,cos_unit_id) where cos_unit_id is not null;
create function clinical.pin_cos_report_unit() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status='draft' and new.status='signed' then
  select case when count(distinct ca.unit_id)=1 then (array_agg(distinct ca.unit_id))[1] else null end into new.cos_unit_id from clinical.call_assignment ca where ca.organization_id=new.organization_id and ca.report_id=new.id;
 elsif old.status='signed' and new.cos_unit_id is distinct from old.cos_unit_id then
  raise exception 'signed operational unit is immutable';
 end if;
 return new;
end $$;
revoke all on function clinical.pin_cos_report_unit() from public;
create trigger pin_cos_report_unit before update on clinical.report for each row execute function clinical.pin_cos_report_unit();

alter table app_identity.regional_identity_request add column hsa_evidence jsonb;
grant update(hsa_evidence) on app_identity.regional_identity_request to open_triage_api_runtime;
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on app_identity.destination_directory,app_identity.destination_revision from %I',role_name);
  end if;
 end loop;
end $$;

-- Private, append-only manifest and receipt journal. A committed sending event is
-- an uncertain remote effect until verified; missing receipts never permit POST replay.
create table clinical.cos_artifact (
 delivery_id uuid not null,
 report_id uuid not null,
 artifact_key text not null check(length(artifact_key) between 1 and 200),
 kind text not null check(kind in ('patient','encounter','observation','note','pdf','context')),
 source_key text,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 resource jsonb not null,
 primary key(delivery_id,artifact_key),
 unique(delivery_id,artifact_key,report_id),
 foreign key(delivery_id,report_id) references clinical.cos_delivery(id,report_id) on delete cascade
);
create index cos_artifact_report_source on clinical.cos_artifact(report_id,source_key) where source_key is not null;
create table clinical.cos_artifact_event (
 id bigint generated always as identity primary key,
 report_id uuid not null references clinical.report(id) on delete cascade,
 delivery_id uuid not null,
 artifact_key text not null,
 state text not null check(state in ('prepared','sending','accepted','verified','rejected','uncertain','unresolved')),
 remote_id text check(remote_id ~ '^[A-Za-z0-9.-]{1,100}$'),
 evidence jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(delivery_id,artifact_key,report_id) references clinical.cos_artifact(delivery_id,artifact_key,report_id) on delete cascade
);
create index cos_artifact_event_report on clinical.cos_artifact_event(report_id);
create index cos_artifact_event_latest on clinical.cos_artifact_event(delivery_id,artifact_key,id desc);
create trigger cos_artifact_immutable before update or delete on clinical.cos_artifact for each row execute function public.prevent_update_or_delete();
create trigger cos_artifact_event_immutable before update or delete on clinical.cos_artifact_event for each row execute function public.prevent_update_or_delete();
revoke all on clinical.cos_artifact,clinical.cos_artifact_event from public,open_triage_api_runtime;
grant select,insert on clinical.cos_artifact,clinical.cos_artifact_event to open_triage_api_runtime;
grant usage,select on sequence clinical.cos_artifact_event_id_seq to open_triage_api_runtime;
-- Clinical schema is intentionally not exposed via PostgREST; explicit deny for browser roles.
do $$ declare role_name text; begin
 foreach role_name in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=role_name) then
   execute format('revoke all on clinical.cos_artifact,clinical.cos_artifact_event from %I',role_name);
  end if;
 end loop;
end $$;

-- Cascaded deletes run after the parent submission/attempt is gone. Persist the
-- report lineage on every immutable receipt so the shared append-only guard can
-- authorize retention from OLD without a missing-parent lookup or a broad bypass.
create index eps_submission_attempt_report on clinical.eps_submission_attempt(report_id);
create index eps_submission_result_report on clinical.eps_submission_result(report_id);

create function clinical.pin_eps_receipt_report() returns trigger
language plpgsql security invoker set search_path='' as $$
declare parent_report_id uuid;
begin
 if tg_table_name='eps_submission_attempt' then
  select report_id into parent_report_id from clinical.eps_submission where id=new.submission_id;
 elsif tg_table_name='eps_submission_result' then
  select report_id into parent_report_id from clinical.eps_submission_attempt where id=new.attempt_id;
 else
  raise exception 'Unsupported EPS receipt table';
 end if;
 if parent_report_id is null or (new.report_id is not null and new.report_id<>parent_report_id) then
  raise exception 'EPS receipt report must match its parent' using errcode='23503';
 end if;
 new.report_id:=parent_report_id;
 return new;
end;
$$;
revoke all on function clinical.pin_eps_receipt_report() from public;
create trigger eps_submission_attempt_report before insert on clinical.eps_submission_attempt
 for each row execute function clinical.pin_eps_receipt_report();
create trigger eps_submission_result_report before insert on clinical.eps_submission_result
 for each row execute function clinical.pin_eps_receipt_report();

-- Review completion records a human disposition, not proof of COS delivery.
-- Keep EPS's export-specific completion rule; COS evidence and delivery state
-- remain independent of the review item's outcome.

-- Patient payloads and receipts stay in the existing private, report-retained ledger.
-- Atomic claim across concurrent reports and rebuilt deliveries. A lost receipt
-- never releases this claim. The key hashes receiver scope and exact identifier.
create unique index cos_patient_registration_once
 on clinical.cos_artifact_event ((evidence->>'patientRegistrationKey'))
 where state='sending' and evidence ? 'patientRegistrationKey';

alter table clinical.cos_delivery add constraint cos_delivery_signing_submission_fk
 foreign key(signing_submission_id,report_id) references clinical.signing_submission(id,report_id) on delete cascade;
alter table clinical.cos_delivery add constraint cos_delivery_source_check
 check(snapshot_id is not null or signing_submission_id is not null);
create unique index cos_delivery_signing_submission on clinical.cos_delivery(signing_submission_id) where signing_submission_id is not null and lineage_parent_id is null;
grant update(snapshot_id) on clinical.cos_delivery to open_triage_api_runtime;

-- Preserve the distinction between a request to sign and a finalized signature in audit.

-- Preserve receiver acceptance separately from independently proven storage.

-- Project only bounded operational metadata. Never retain requests, clinical answers,
-- patient identifiers or raw receiver bodies beyond clinical retention.
create function clinical_audit.record_cos_artifact_verification() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.state in ('prepared','sending') then return new; end if;
 insert into clinical_audit.hospital_operational_event
 (id,organization_id,report_id,integration,verification,source_id,snapshot_id,signing_submission_id,
 amendment_sequence,synthetic,configuration_revision,mapping_id,mapping_revision,mapping_sha256,
 action,state,occurred_at,verification_details)
 select gen_random_uuid(),d.organization_id,d.report_id,'cos','unverified',d.id,d.snapshot_id,d.signing_submission_id,
 d.amendment_sequence,r.synthetic,d.configuration_revision,d.mapping_id,d.mapping_revision,d.mapping_sha256,
 'cos.verification',new.state,new.created_at,jsonb_strip_nulls(jsonb_build_object(
 'artifactType',a.kind,'artifactKey',new.artifact_key,
 'verificationOutcome',case when new.evidence->>'verificationOutcome' in ('skipped','unresolved','not-found') then new.evidence->>'verificationOutcome' else new.state end,
 'verificationReason',case when new.evidence->>'reason' ~ '^[A-Za-z][A-Za-z0-9]{0,99}$' then new.evidence->>'reason' end,
 'readBackVerification',coalesce((v.settings->'live'->>'readBackVerification')::boolean,true),
 'verificationHttpStatus',coalesce(new.evidence->'journalEvidence'->'httpStatus',new.evidence->'verificationFailure'->'response'->'httpStatus',new.evidence->'httpStatus'),
 'journalExtractCount',new.evidence->'journalEvidence'->'extractCount',
 'verificationRequestId',left(coalesce(new.evidence->'journalEvidence'->'correlation'->>'x-request-id',new.evidence->'responseEvidence'->'correlation'->>'x-request-id'),200)))
 from clinical.cos_delivery d join clinical.report r on r.id=d.report_id
 join clinical.cos_artifact a on a.delivery_id=d.id and a.artifact_key=new.artifact_key
 join app_identity.hospital_cos_version v on v.group_id=d.group_id and v.revision=d.configuration_revision
 where d.id=new.delivery_id;
 return new;
end $$;
revoke all on function clinical_audit.record_cos_artifact_verification() from public;
grant execute on function clinical_audit.record_cos_artifact_verification() to open_triage_api_runtime;
create trigger cos_artifact_verification_audit after insert on clinical.cos_artifact_event
 for each row execute function clinical_audit.record_cos_artifact_verification();

-- Prepared exports can belong to an unsigned signing request. Preserve immutable evidence.
alter table clinical.eps_submission add constraint eps_submission_signing_source_fk
 foreign key(signing_submission_id,report_id) references clinical.signing_submission(id,report_id) on delete cascade;
alter table clinical.eps_submission add constraint eps_submission_source_check
 check ((snapshot_id is not null) <> (signing_submission_id is not null));
create index eps_submission_signing_source on clinical.eps_submission(signing_submission_id) where signing_submission_id is not null;

comment on table clinical_audit.hospital_operational_event is 'Append-only metadata audit; no clinical source, patient identifiers, provider bodies, endpoints or credentials. Clinical artifacts expire independently.';
