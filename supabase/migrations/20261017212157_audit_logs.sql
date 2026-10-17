-- Consolidated audit logging: patient access, analytics requests and audit inspections.
-- Apply once after the existing committed migrations. Existing source primary keys,
-- historical role versions and recorded events remain intact.
set local lock_timeout = '5s';

-- A separate channel from diagnostic/query telemetry and mutable clinical data.
-- No cascading foreign keys: account, report, patient and synthetic-data deletion
-- must not erase access evidence. UUIDs remain sensitive, linkable identifiers.
create table clinical_audit.patient_access_event (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  organization_id uuid not null,
  access_organization_id uuid not null,
  actor_id uuid not null,
  patient_id uuid not null,
  report_id uuid not null,
  action text not null check (action in (
    'report.read', 'report.reopen', 'report.active', 'report.list', 'assignment.open',
    'review.report', 'review.overdue', 'photo.read', 'audio.read',
    'analytics.query', 'analytics.export.aggregate', 'analytics.export.records', 'audit.clinical-values'
  )),
  care_process text not null check (care_process in ('documentation', 'review', 'analytics', 'audit')),
  resource_id uuid,
  synthetic boolean not null,
  audit_id uuid not null default gen_random_uuid() unique,
  constraint patient_access_event_resource_check
    check ((action in ('photo.read', 'audio.read', 'analytics.query', 'analytics.export.aggregate', 'analytics.export.records'))
      = (resource_id is not null))
);

create index patient_access_event_patient_time_idx
  on clinical_audit.patient_access_event (organization_id, patient_id, occurred_at, id);
create index patient_access_event_actor_time_idx
  on clinical_audit.patient_access_event (organization_id, actor_id, occurred_at, id);
create index patient_access_event_time_idx
  on clinical_audit.patient_access_event (occurred_at, id);

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_patient_audit_reader') then
    create role open_triage_patient_audit_reader nologin nosuperuser nocreatedb
      nocreaterole inherit nobypassrls;
  end if;
end $$;

-- Override the broad default privileges on clinical_audit for this table.
revoke all on clinical_audit.patient_access_event from public, open_triage_api_runtime;
revoke all on sequence clinical_audit.patient_access_event_id_seq from public, open_triage_api_runtime;
grant insert (organization_id, access_organization_id, actor_id, patient_id, report_id,
  action, care_process, resource_id, synthetic)
  on clinical_audit.patient_access_event to open_triage_api_runtime;
grant usage on sequence clinical_audit.patient_access_event_id_seq to open_triage_api_runtime;
grant usage on schema clinical_audit to open_triage_patient_audit_reader;
grant select on clinical_audit.patient_access_event to open_triage_patient_audit_reader;

alter table clinical_audit.patient_access_event enable row level security;
create policy patient_access_append on clinical_audit.patient_access_event
  for insert to open_triage_api_runtime with check (true);
-- This is an installation-wide operational role, never an application capability.
create policy patient_access_review on clinical_audit.patient_access_event
  for select to open_triage_patient_audit_reader using (true);

create function clinical_audit.reject_patient_access_change() returns trigger
  language plpgsql set search_path = pg_catalog as $$
begin
  raise exception 'Patient access audit events are append-only' using errcode = '42501';
end $$;
revoke all on function clinical_audit.reject_patient_access_change() from public;
create trigger patient_access_immutable
  before update or delete or truncate on clinical_audit.patient_access_event
  for each statement execute function clinical_audit.reject_patient_access_change();

comment on table clinical_audit.patient_access_event is
  'Committed authorized API reads; not proof of network delivery or offline viewing. No automatic expiry. Preserve at least five years subject to the approved retention policy. Independent protected archival is required.';
comment on role open_triage_patient_audit_reader is
  'Installation-wide patient-access evidence reader for explicitly authorized audit operators; never grant to API, analyst or ordinary application users';

create table clinical_audit.audit_read_event (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  organization_id uuid not null,
  actor_id uuid not null,
  category text not null check (category in ('patient', 'authentication', 'authorization',
    'configuration', 'clinical', 'media', 'recovery', 'review', 'synthetic', 'installations', 'feedback', 'audit', 'analytics', 'combined')),
  from_time timestamptz not null,
  to_time timestamptz not null check (to_time > from_time),
  actor_filter uuid,
  target_filter uuid,
  returned_count integer not null check (returned_count between 0 and 50),
  inspection_kind text not null default 'list' check (inspection_kind in ('list','clinical-values','payload')),
  inspected_source text,
  inspected_event_id text,
  audit_id uuid not null default gen_random_uuid() unique,
  inspected_event_uuid uuid,
  queried_categories text[],
  uuid_filter uuid,
  constraint audit_read_event_uuid_reference_check
    check ((inspected_event_uuid is null) = (inspected_event_id is null)),
  constraint audit_read_event_inspected_event_check check (
    (inspected_source is null and inspected_event_id is null) or
    (inspected_source is not null and inspected_event_id is not null
      and length(inspected_event_id) between 1 and 64
      and (
        (inspection_kind='payload' and inspected_source in
          ('clinical_audit.analytics_access_event','feedback.submission','feedback.review_event')) or
        (inspection_kind='clinical-values' and inspected_source in
          ('clinical_audit.event','clinical.report_change','clinical_audit.draft_reconciliation',
           'clinical_audit.post_signature_audit_note'))
      ))
  ),
  constraint audit_read_event_queried_categories_check check (
    (category <> 'combined' or (queried_categories is not null and cardinality(queried_categories) > 1))
    and (queried_categories is null or (
      inspection_kind = 'list'
      and cardinality(queried_categories) between 1 and 13
      and array_ndims(queried_categories) = 1
      and array_position(queried_categories, null) is null
      and queried_categories <@ array['patient', 'authentication', 'authorization', 'configuration', 'clinical',
        'media', 'recovery', 'review', 'synthetic', 'installations', 'feedback', 'audit', 'analytics']::text[]
      and (category = 'combined' or queried_categories = array[category])
    ))
  )
);
create index audit_read_event_agency_time_idx
  on clinical_audit.audit_read_event (organization_id, occurred_at desc, id desc);
revoke all on clinical_audit.audit_read_event from public, open_triage_api_runtime;
revoke all on sequence clinical_audit.audit_read_event_id_seq from public, open_triage_api_runtime;
grant insert (organization_id, actor_id, category, from_time, to_time, actor_filter, target_filter, returned_count,
  inspection_kind, inspected_source, inspected_event_id, inspected_event_uuid, queried_categories, uuid_filter)
  on clinical_audit.audit_read_event to open_triage_api_runtime;
grant usage on sequence clinical_audit.audit_read_event_id_seq to open_triage_api_runtime;
grant select on clinical_audit.audit_read_event, clinical_audit.patient_access_event
  to open_triage_api_runtime, open_triage_patient_audit_reader;
alter table clinical_audit.audit_read_event enable row level security;
create policy audit_read_append on clinical_audit.audit_read_event
  for insert to open_triage_api_runtime with check (true);
create policy audit_read_operator on clinical_audit.audit_read_event
  for select to open_triage_patient_audit_reader using (true);
create policy audit_read_agency on clinical_audit.audit_read_event
  for select to open_triage_api_runtime
  using (organization_id = nullif(current_setting('open_triage.audit_organization_id', true), '')::uuid);
create policy patient_access_agency on clinical_audit.patient_access_event
  for select to open_triage_api_runtime
  using (organization_id = nullif(current_setting('open_triage.audit_organization_id', true), '')::uuid);
create trigger audit_read_immutable before update or delete or truncate on clinical_audit.audit_read_event
  for each statement execute function clinical_audit.reject_patient_access_change();

-- Only metadata columns are needed from the otherwise isolated recovery schema.
grant usage on schema offline_recovery to open_triage_api_runtime;
grant select (id, organization_id, report_id, event_type, occurred_at)
  on offline_recovery.event to open_triage_api_runtime;
grant select (id, organization_id, report_id, actor_user_id, event_type, outcome, occurred_at)
  on offline_recovery.key_lifecycle_event to open_triage_api_runtime;
grant select (id, organization_id, report_id, user_id, action, outcome, occurred_at)
  on offline_recovery.report_recovery_event to open_triage_api_runtime;

comment on table clinical_audit.audit_read_event is
  'Agency audit-browser queries, including empty results; metadata only. Append-only, no automatic expiry. Does not establish completion of a formal access review.';

create table clinical_audit.analytics_access_event (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default clock_timestamp(),
  organization_id uuid not null,
  actor_id uuid not null,
  surface text not null check (surface in ('analytics', 'review.analysis', 'review.volume', 'review.workload')),
  operation text not null check (operation in ('query', 'counts', 'elements', 'values', 'export.aggregate', 'export.records')),
  dataset text not null check (dataset in ('real', 'synthetic')),
  from_date date,
  through_date date,
  report_scope text not null check (report_scope in ('own', 'all')),
  identifying boolean not null,
  scoped_organization_ids uuid[] not null check (cardinality(scoped_organization_ids) > 0),
  report_count integer check (report_count between 0 and 20000),
  query_payload jsonb check (query_payload is null or jsonb_typeof(query_payload) = 'object'),
  check ((from_date is null and through_date is null) or
    (from_date is not null and through_date is not null and through_date >= from_date))
);
create index analytics_access_event_agency_time_idx
  on clinical_audit.analytics_access_event (organization_id, occurred_at desc, id desc);
revoke all on clinical_audit.analytics_access_event from public, open_triage_api_runtime;
grant insert (organization_id, actor_id, surface, operation, dataset, from_date, through_date,
  report_scope, identifying, scoped_organization_ids, report_count, query_payload)
  on clinical_audit.analytics_access_event to open_triage_api_runtime;
grant select on clinical_audit.analytics_access_event to open_triage_api_runtime, open_triage_patient_audit_reader;
alter table clinical_audit.analytics_access_event enable row level security;
create policy analytics_access_append on clinical_audit.analytics_access_event
  for insert to open_triage_api_runtime with check (true);
create policy analytics_access_agency on clinical_audit.analytics_access_event
  for select to open_triage_api_runtime
  using (organization_id = nullif(current_setting('open_triage.audit_organization_id', true), '')::uuid);
create policy analytics_access_operator on clinical_audit.analytics_access_event
  for select to open_triage_patient_audit_reader using (true);
create trigger analytics_access_immutable before update or delete or truncate on clinical_audit.analytics_access_event
  for each statement execute function clinical_audit.reject_patient_access_change();

comment on column clinical_audit.analytics_access_event.query_payload is
  'Validated analytics definition or discovery request, including search/filter literals. Available only through an identifying audit inspection; NULL means not captured.';
comment on table clinical_audit.analytics_access_event is
  'Authorized analytics queries, discovery and CSV preparation with validated request snapshots. Primary-database evidence; no response values or CSV content. Patient-access resource_id links contributing reports. Append-only, no automatic expiry.';

comment on column clinical_audit.audit_read_event.queried_categories is
  'Actual authorized log types in this list inspection, including all permitted types when the filter is blank. Null for older or individual-event inspections.';

comment on column clinical_audit.audit_read_event.uuid_filter is
  'Exact UUID searched across event, actor, target, patient, resource, agency and inspection metadata. Does not search payload content. Historical target_filter evidence is unchanged.';

comment on column clinical_audit.audit_read_event.inspected_event_uuid is
  'Permanent UUID of the inspected event, independent of its internal source key.';

-- Permanent public UUIDs for retained and future events in existing ledgers.
create function clinical_audit.reject_audit_id_change() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.audit_id is distinct from old.audit_id then
    raise exception 'Audit event UUIDs are immutable' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function clinical_audit.reject_audit_id_change() from public;

do $$ declare source_name text;
begin
  foreach source_name in array array[
    'app_identity.agency_demographic_change_event', 'app_identity.agency_settings_change_event',
    'app_identity.authentication_event', 'app_identity.authorization_event',
    'app_identity.configuration_event', 'app_identity.installation_event',
    'app_identity.operational_unit_event', 'app_identity.operator_identity_event',
    'app_identity.organization_event', 'app_identity.ownership_transfer_event',
    'clinical_audit.audit_read_event', 'clinical_audit.draft_reconciliation',
    'clinical_audit.event', 'clinical_audit.patient_access_event',
    'clinical_audit.post_signature_audit_note', 'clinical_audit.report_media_access_event',
    'clinical_audit.report_note_mutation_event', 'clinical_audit.synthetic_draft_mutation_event',
    'clinical_audit.synthetic_generation_event', 'feedback.review_event', 'feedback.submission',
    'offline_recovery.event', 'offline_recovery.key_lifecycle_event',
    'offline_recovery.report_recovery_event', 'validation.change_event'
  ] loop
    if source_name not in ('clinical_audit.audit_read_event', 'clinical_audit.patient_access_event') then
      execute format('alter table %s add column audit_id uuid not null default gen_random_uuid() unique', source_name::regclass);
    end if;
    execute format('grant select (audit_id) on %s to open_triage_api_runtime', source_name::regclass);
    execute format('create trigger audit_id_immutable before update of audit_id on %s for each row execute function clinical_audit.reject_audit_id_change()', source_name::regclass);
    execute format('comment on column %s.audit_id is %L', source_name::regclass,
      'Permanent public audit event UUID. The original primary key remains an internal source reference.');
  end loop;
end $$;

alter table app_identity.capability drop constraint capability_fixed_registry;
alter table app_identity.capability add constraint capability_fixed_registry check (key in (
  'clinical:document', 'clinical:demo', 'admin-dashboard:read', 'audit:read', 'audit:identifying',
  'users:read', 'users:write', 'credentials:reset', 'sessions:read', 'sessions:revoke',
  'roles:read', 'roles:write', 'roles:assign', 'catalog:read', 'catalog:write', 'catalog:publish',
  'forms:read', 'forms:write', 'forms:publish', 'validation:read', 'validation:write',
  'validation:publish', 'settings:read', 'settings:write',
  'review:self', 'review:all', 'review:admin', 'review:identifying'
));
insert into app_identity.capability (key, description, system_only, administrative)
values ('audit:read', 'Inspect agency audit logs', false, true),
  ('audit:identifying', 'Inspect patient-related audit logs and clinical values', false, true);
insert into app_identity.capability_prerequisite(capability_key,prerequisite_key)
values ('audit:identifying','audit:read');

-- Existing protected roles use every registered capability (Demo excludes publish).
-- Preserve historical versions and custom roles.
do $$ declare selected record; next_id uuid;
begin
  for selected in select r.*, v.version from app_identity.role r
    join app_identity.role_version v on v.id = r.current_version_id
    where r.protected and r.system_key in ('administrator', 'demo')
  loop
    next_id := gen_random_uuid();
    insert into app_identity.role_version (id, organization_id, role_id, version, note)
    values (next_id, selected.organization_id, selected.id, selected.version + 1, 'Add agency and identifying audit inspection');
    insert into app_identity.role_version_capability (organization_id, role_version_id, role_id, capability_key)
    select selected.organization_id, next_id, selected.id, capability_key
      from app_identity.role_version_capability where role_version_id = selected.current_version_id
    union all select selected.organization_id, next_id, selected.id, key
      from unnest(array['audit:read','audit:identifying']) key;
    update app_identity.role set current_version_id = next_id where id = selected.id;
  end loop;
end $$;

-- Installation authority does not grant identifying patient access.
create or replace function app_identity.user_has_capability(
  candidate_user_id uuid, candidate_organization_id uuid, candidate_capability text
) returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (select 1 from app_identity.capability where key = candidate_capability)
    and app_identity.user_can_access_organization(candidate_user_id, candidate_organization_id)
    and (not app_identity.is_installation_superadmin(candidate_user_id)
      or candidate_capability not in ('review:all', 'review:admin', 'review:identifying', 'audit:identifying'))
    and (app_identity.is_installation_superadmin(candidate_user_id) or
      (exists (select 1 from app_identity.installation_owner) and exists (
        select 1 from app_identity.user_role_assignment assignment
        join app_identity.role role on role.id = assignment.role_id
          and role.organization_id = assignment.organization_id and role.active and role.assignable
        join app_identity.role_version_capability definition on definition.role_version_id = role.current_version_id
          and definition.role_id = role.id and definition.organization_id = role.organization_id
        where assignment.user_id = candidate_user_id and assignment.ended_at is null
          and app_identity.organization_group(assignment.organization_id) = app_identity.organization_group(candidate_organization_id)
          and definition.capability_key = candidate_capability)));
$$;
