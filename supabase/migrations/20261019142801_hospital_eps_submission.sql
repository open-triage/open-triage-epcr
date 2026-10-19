-- Private, report-retained immutable prepared documents and append-only publication evidence.
create table clinical.eps_submission (
 id uuid primary key, report_id uuid not null references clinical.report(id) on delete cascade,
 snapshot_id uuid not null references clinical.signed_snapshot(id) on delete cascade,
 amendment_sequence integer not null check(amendment_sequence>=0),
 organization_id uuid not null references app_identity.organization(id),group_id uuid not null,
 configuration_revision bigint not null,mapping_id text not null,mapping_revision integer not null,mapping_sha256 text not null,
 destination text not null,bundle jsonb not null,validation jsonb not null,payload_sha256 text not null,
 source_sha256 text not null,amendment_hashes jsonb not null,
 lineage_parent_id uuid references clinical.eps_submission(id) on delete cascade,
 prepared_by uuid not null references app_identity.app_user(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(group_id,configuration_revision) references app_identity.hospital_eps_version(group_id,revision)
);
create index eps_submission_report on clinical.eps_submission(report_id,created_at);
create index eps_submission_snapshot on clinical.eps_submission(snapshot_id);
create index eps_submission_organization on clinical.eps_submission(organization_id);
create index eps_submission_configuration on clinical.eps_submission(group_id,configuration_revision);
create index eps_submission_actor on clinical.eps_submission(prepared_by);
create index eps_submission_lineage on clinical.eps_submission(lineage_parent_id);
create table clinical.eps_submission_attempt (
 id uuid primary key, submission_id uuid not null unique references clinical.eps_submission(id) on delete cascade,
 command_id uuid not null unique,actor_id uuid not null references app_identity.app_user(id),
 created_at timestamptz not null default clock_timestamp()
);
create index eps_submission_attempt_actor on clinical.eps_submission_attempt(actor_id);
create table clinical.eps_submission_result (
 attempt_id uuid primary key references clinical.eps_submission_attempt(id) on delete cascade,
 state text not null check(state in ('accepted','rejected','unknown')), evidence jsonb not null,
 created_at timestamptz not null default clock_timestamp()
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
alter table clinical_audit.patient_access_event drop constraint patient_access_event_action_check;
alter table clinical_audit.patient_access_event add constraint patient_access_event_action_check check(action in (
 'report.read','report.reopen','report.active','report.list','assignment.open','review.report','review.overdue','photo.read','audio.read',
 'analytics.query','analytics.export.aggregate','analytics.export.records','audit.clinical-values','eps.read','eps.import','eps.export','eps.submit'
));
alter table clinical_audit.patient_access_event drop constraint patient_access_eps_provenance_check;
alter table clinical_audit.patient_access_event add constraint patient_access_eps_provenance_check check(
 (action in ('eps.read','eps.import','eps.export','eps.submit') and integration_provenance is not null and jsonb_typeof(integration_provenance)='object'
  and integration_provenance ?& array['configurationRevision','mappingId','mappingRevision','mappingSha256'])
 or(action not in ('eps.read','eps.import','eps.export','eps.submit') and integration_provenance is null)
);
alter table clinical_audit.patient_access_event drop constraint patient_access_event_resource_check;
alter table clinical_audit.patient_access_event add constraint patient_access_event_resource_check check(
 (action in ('photo.read','audio.read','analytics.query','analytics.export.aggregate','analytics.export.records','eps.export','eps.submit'))=(resource_id is not null)
);
