set local lock_timeout = '5s';
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
 source_key text not null, occurrence_id uuid, decision text not null check(decision in ('import','keep','replace')),
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

alter table clinical_audit.patient_access_event drop constraint patient_access_event_action_check;
alter table clinical_audit.patient_access_event add constraint patient_access_event_action_check check (action in (
  'report.read', 'report.reopen', 'report.active', 'report.list', 'assignment.open',
  'review.report', 'review.overdue', 'photo.read', 'audio.read',
  'analytics.query', 'analytics.export.aggregate', 'analytics.export.records', 'audit.clinical-values', 'eps.read', 'eps.import'
));

alter table clinical_audit.patient_access_event drop constraint patient_access_eps_provenance_check;
alter table clinical_audit.patient_access_event add constraint patient_access_eps_provenance_check check (
  (action in ('eps.read','eps.import') and integration_provenance is not null and jsonb_typeof(integration_provenance) = 'object'
    and integration_provenance ?& array['configurationRevision','mappingId','mappingRevision','mappingSha256'])
  or (action not in ('eps.read','eps.import') and integration_provenance is null)
);

create trigger eps_import_immutable before update on clinical.eps_import
for each row execute function public.prevent_update_or_delete();
do $$ declare browser_role text; begin
 foreach browser_role in array array['anon','authenticated'] loop
  if exists(select 1 from pg_roles where rolname=browser_role) then
   execute format('revoke all on clinical.eps_import_plan,clinical.eps_import from %I',browser_role);
  end if;
 end loop;
end $$;
