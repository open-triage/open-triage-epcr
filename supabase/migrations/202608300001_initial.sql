create extension if not exists pgcrypto;

create schema if not exists app_identity;
create schema if not exists catalog;
create schema if not exists forms;
create schema if not exists clinical;
create schema if not exists clinical_audit;
create schema if not exists integration;
create schema if not exists analytics_private;
create schema if not exists analytics;

revoke all on schema analytics_private from public;

create function public.prevent_update_or_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_schema || '.' || tg_table_name;
end;
$$;

create table app_identity.organization (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  retention_years integer not null default 10 check (retention_years between 1 and 100),
  deployment_timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_identity.app_user (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  display_name text not null,
  active boolean not null default true,
  synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz
);

create table app_identity.external_identity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_identity.app_user(id),
  provider text not null,
  subject text not null,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);

create table app_identity.capability (
  key text primary key,
  description text not null
);

create table app_identity.user_capability (
  user_id uuid not null references app_identity.app_user(id),
  capability_key text not null references app_identity.capability(key),
  granted_at timestamptz not null default now(),
  granted_by uuid references app_identity.app_user(id),
  primary key (user_id, capability_key)
);

create table catalog.release (
  id uuid primary key default gen_random_uuid(),
  standard text not null,
  version text not null,
  dataset text not null,
  artifact_schema_version text not null,
  artifact_sha256 text not null check (artifact_sha256 ~ '^[a-f0-9]{64}$'),
  provenance jsonb not null,
  loaded_at timestamptz not null default now(),
  unique (standard, version, dataset),
  unique (artifact_sha256)
);

create table catalog.element_identity (
  id uuid primary key,
  namespace text not null,
  canonical_key text not null,
  created_at timestamptz not null default now(),
  unique (namespace, canonical_key)
);

create table catalog.group_definition (
  release_id uuid not null references catalog.release(id) on delete cascade,
  group_id text not null,
  parent_group_id text,
  name text not null,
  path text[] not null,
  min_occurs integer not null check (min_occurs >= 0),
  max_occurs integer check (max_occurs is null or max_occurs >= 1),
  unbounded boolean not null,
  repeating boolean not null,
  definition jsonb not null,
  primary key (release_id, group_id),
  foreign key (release_id, parent_group_id)
    references catalog.group_definition(release_id, group_id)
    deferrable initially deferred
);

create table catalog.element_definition (
  release_id uuid not null references catalog.release(id) on delete cascade,
  element_id text not null,
  element_identity_id uuid not null references catalog.element_identity(id),
  section text not null,
  name text not null,
  description text not null,
  national boolean not null,
  state boolean not null,
  usage text not null check (usage in ('Mandatory', 'Required', 'Recommended', 'Optional')),
  source_datatype text not null,
  base_datatype text not null check (base_datatype in ('string', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'time', 'duration', 'binary', 'anyURI')),
  group_path text[] not null,
  min_occurs integer not null check (min_occurs >= 0),
  max_occurs integer check (max_occurs is null or max_occurs >= 1),
  unbounded boolean not null,
  nillable boolean not null,
  supports_not_values boolean not null,
  supports_pertinent_negatives boolean not null,
  definition jsonb not null,
  primary key (release_id, element_id),
  unique (release_id, element_identity_id)
);

create function catalog.prevent_incompatible_element_datatype()
returns trigger
language plpgsql
as $$
declare
  existing_datatype text;
begin
  select base_datatype into existing_datatype
  from catalog.element_definition
  where element_identity_id = new.element_identity_id
  limit 1;

  if existing_datatype is not null and existing_datatype <> new.base_datatype then
    raise exception 'element identity % cannot change base datatype from % to %',
      new.element_identity_id, existing_datatype, new.base_datatype;
  end if;
  return new;
end;
$$;

create trigger catalog_element_datatype_compatible
before insert or update of element_identity_id, base_datatype on catalog.element_definition
for each row execute function catalog.prevent_incompatible_element_datatype();

create index element_definition_search_idx
  on catalog.element_definition using gin
  (to_tsvector('simple', element_id || ' ' || name || ' ' || description));

create table catalog.element_option (
  release_id uuid not null,
  element_id text not null,
  source_kind text not null check (source_kind in ('inline', 'not-value', 'pertinent-negative')),
  code text not null,
  display text not null,
  code_system text not null default '',
  primary key (release_id, element_id, source_kind, code_system, code),
  foreign key (release_id, element_id)
    references catalog.element_definition(release_id, element_id)
    on delete cascade
);

create table catalog.value_set (
  release_id uuid not null references catalog.release(id) on delete cascade,
  value_set_id text not null,
  name text not null,
  classification text not null,
  published_at text not null,
  exhaustive boolean not null,
  definition jsonb not null,
  primary key (release_id, value_set_id)
);

create table catalog.value_set_element (
  release_id uuid not null,
  value_set_id text not null,
  element_id text not null,
  primary key (release_id, value_set_id, element_id),
  foreign key (release_id, value_set_id)
    references catalog.value_set(release_id, value_set_id)
    on delete cascade,
  foreign key (release_id, element_id)
    references catalog.element_definition(release_id, element_id)
    on delete cascade
);

create table catalog.value_set_option (
  release_id uuid not null,
  value_set_id text not null,
  code text not null,
  code_system text not null default '',
  display text not null,
  source_display text not null,
  category text,
  primary key (release_id, value_set_id, code_system, code),
  foreign key (release_id, value_set_id)
    references catalog.value_set(release_id, value_set_id)
    on delete cascade
);

create table catalog.repeating_group_time_mapping (
  release_id uuid not null,
  group_id text not null,
  resolution text not null check (resolution in ('element', 'inherited', 'non-temporal')),
  time_element_id text,
  inherited_from_group_id text,
  candidate_time_element_ids text[] not null default '{}',
  note text not null,
  primary key (release_id, group_id),
  foreign key (release_id, group_id)
    references catalog.group_definition(release_id, group_id)
    on delete cascade,
  foreign key (release_id, time_element_id)
    references catalog.element_definition(release_id, element_id),
  foreign key (release_id, inherited_from_group_id)
    references catalog.group_definition(release_id, group_id),
  check (
    (resolution = 'element' and time_element_id is not null and inherited_from_group_id is null)
    or (resolution = 'inherited' and time_element_id is not null and inherited_from_group_id is not null)
    or (resolution = 'non-temporal' and time_element_id is null and inherited_from_group_id is null)
  )
);

create table catalog.analytics_element_mapping (
  release_id uuid not null,
  element_id text not null,
  element_identity_id uuid not null references catalog.element_identity(id),
  analytical_location text not null check (analytical_location in ('wide', 'repeatable')),
  sql_column text,
  sql_type text not null,
  identifying boolean not null,
  mapping jsonb not null,
  primary key (release_id, element_id),
  foreign key (release_id, element_id)
    references catalog.element_definition(release_id, element_id)
    on delete cascade,
  check (
    (analytical_location = 'wide' and sql_column is not null)
    or (analytical_location = 'repeatable' and sql_column is null)
  )
);

create unique index analytics_element_mapping_sql_column_key
  on catalog.analytics_element_mapping (release_id, sql_column)
  where sql_column is not null;

create trigger catalog_release_immutable before update or delete on catalog.release
for each row execute function public.prevent_update_or_delete();
create trigger catalog_element_identity_immutable before update or delete on catalog.element_identity
for each row execute function public.prevent_update_or_delete();
create trigger catalog_group_definition_immutable before update or delete on catalog.group_definition
for each row execute function public.prevent_update_or_delete();
create trigger catalog_element_definition_immutable before update or delete on catalog.element_definition
for each row execute function public.prevent_update_or_delete();
create trigger catalog_element_option_immutable before update or delete on catalog.element_option
for each row execute function public.prevent_update_or_delete();
create trigger catalog_value_set_immutable before update or delete on catalog.value_set
for each row execute function public.prevent_update_or_delete();
create trigger catalog_value_set_element_immutable before update or delete on catalog.value_set_element
for each row execute function public.prevent_update_or_delete();
create trigger catalog_value_set_option_immutable before update or delete on catalog.value_set_option
for each row execute function public.prevent_update_or_delete();
create trigger catalog_group_time_mapping_immutable before update or delete on catalog.repeating_group_time_mapping
for each row execute function public.prevent_update_or_delete();
create trigger catalog_analytics_mapping_immutable before update or delete on catalog.analytics_element_mapping
for each row execute function public.prevent_update_or_delete();

create table app_identity.agency_demographic_version (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  catalog_release_id uuid not null references catalog.release(id),
  version integer not null check (version >= 1),
  dagency_01 text not null,
  dagency_02 text not null,
  dagency_04 text not null,
  dagency_04_display text,
  dagency_04_system text,
  dagency_04_terminology_version text,
  definition_sha256 text not null check (definition_sha256 ~ '^[a-f0-9]{64}$'),
  effective_from timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid not null references app_identity.app_user(id),
  unique (organization_id, version),
  unique (organization_id, id, catalog_release_id)
);

create trigger agency_demographic_version_immutable
before update or delete on app_identity.agency_demographic_version
for each row execute function public.prevent_update_or_delete();

create table forms.form (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references app_identity.organization(id),
  slug text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create table forms.custom_element_definition (
  id uuid primary key references catalog.element_identity(id),
  organization_id uuid not null references app_identity.organization(id),
  namespace text not null,
  slug text not null,
  title text not null,
  base_datatype text not null check (base_datatype in ('string', 'integer', 'decimal', 'boolean', 'date', 'dateTime', 'time', 'duration', 'binary', 'anyURI')),
  identifying boolean not null default false,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (organization_id, namespace, slug)
);

create function forms.validate_custom_element_identity()
returns trigger
language plpgsql
as $$
declare
  identity_namespace text;
  identity_key text;
begin
  select namespace, canonical_key into identity_namespace, identity_key
  from catalog.element_identity where id = new.id;
  if identity_namespace is null or identity_namespace = 'NEMSIS' then
    raise exception 'custom element % requires a non-NEMSIS element identity', new.id;
  end if;
  if identity_namespace <> new.namespace or identity_key <> new.namespace || '.' || new.slug then
    raise exception 'custom element namespace and slug do not match identity %', new.id;
  end if;
  return new;
end;
$$;

create trigger custom_element_identity_validate before insert on forms.custom_element_definition
for each row execute function forms.validate_custom_element_identity();

create table forms.custom_group_definition (
  id uuid primary key check (substring(id::text from 15 for 1) = '4' and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  organization_id uuid not null references app_identity.organization(id),
  namespace text not null,
  slug text not null,
  temporal_kind text not null check (temporal_kind in ('clinical', 'non-temporal')),
  clinical_time_element_id uuid references forms.custom_element_definition(id),
  definition jsonb not null,
  created_at timestamptz not null default now(),
  unique (organization_id, namespace, slug),
  check (
    (temporal_kind = 'clinical' and clinical_time_element_id is not null)
    or (temporal_kind = 'non-temporal' and clinical_time_element_id is null)
  )
);

create function forms.validate_custom_group_time()
returns trigger
language plpgsql
as $$
declare
  time_element forms.custom_element_definition%rowtype;
begin
  if new.temporal_kind = 'clinical' then
    select * into time_element from forms.custom_element_definition where id = new.clinical_time_element_id;
    if not found or time_element.organization_id <> new.organization_id or time_element.base_datatype <> 'dateTime' then
      raise exception 'custom clinical group requires one dateTime element from the same organization';
    end if;
  end if;
  return new;
end;
$$;

create trigger custom_group_time_validate before insert on forms.custom_group_definition
for each row execute function forms.validate_custom_group_time();

create trigger custom_group_definition_immutable
before update or delete on forms.custom_group_definition
for each row execute function public.prevent_update_or_delete();

create table forms.form_version (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references forms.form(id),
  catalog_release_id uuid not null references catalog.release(id),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'published')),
  canonical_definition jsonb not null,
  definition_sha256 text not null check (definition_sha256 ~ '^[a-f0-9]{64}$'),
  change_note text,
  cloned_from_id uuid references forms.form_version(id),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  published_by uuid references app_identity.app_user(id),
  published_at timestamptz,
  publication_acknowledgements jsonb,
  unique (form_id, version),
  check (
    (status = 'draft' and published_at is null and published_by is null)
    or (status = 'published' and published_at is not null and published_by is not null and change_note is not null)
  )
);

create table forms.form_locale (
  form_version_id uuid not null references forms.form_version(id) on delete cascade,
  locale text not null,
  translations jsonb not null,
  primary key (form_version_id, locale)
);

create table forms.form_section (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references forms.form_version(id) on delete cascade,
  stable_key text not null,
  position integer not null check (position >= 0),
  presentation jsonb not null default '{}',
  unique (form_version_id, stable_key),
  unique (form_version_id, position)
);

create table forms.form_field (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references forms.form_version(id) on delete cascade,
  section_id uuid not null references forms.form_section(id) on delete cascade,
  stable_key text not null,
  position integer not null check (position >= 0),
  source_kind text not null check (source_kind in ('nemsis', 'custom')),
  catalog_element_identity_id uuid references catalog.element_identity(id),
  custom_element_definition_id uuid references forms.custom_element_definition(id),
  custom_group_definition_id uuid references forms.custom_group_definition(id),
  required boolean not null default false,
  analytical_repeatable boolean not null,
  allowed_absence_states text[] not null default '{}',
  configuration jsonb not null default '{}',
  unique (form_version_id, stable_key),
  unique (section_id, position),
  check (
    (source_kind = 'nemsis' and catalog_element_identity_id is not null and custom_element_definition_id is null)
    or (source_kind = 'custom' and catalog_element_identity_id is null and custom_element_definition_id is not null)
  )
);

create table forms.form_rule (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references forms.form_version(id) on delete cascade,
  target_field_id uuid not null references forms.form_field(id) on delete cascade,
  rule_kind text not null check (rule_kind in ('visibility', 'requiredness')),
  expression jsonb not null,
  position integer not null default 0,
  unique (form_version_id, target_field_id, rule_kind, position)
);

create table forms.publication_validation (
  id uuid primary key default gen_random_uuid(),
  form_version_id uuid not null references forms.form_version(id) on delete cascade,
  severity text not null check (severity in ('error', 'warning')),
  code text not null,
  path text not null,
  message text not null,
  acknowledged_by uuid references app_identity.app_user(id),
  acknowledged_at timestamptz
);

create function forms.prevent_published_form_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'published' then
    raise exception 'published form version % is immutable', old.id;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger form_version_immutable
before update or delete on forms.form_version
for each row execute function forms.prevent_published_form_version_mutation();

create function forms.prevent_published_form_child_mutation()
returns trigger
language plpgsql
as $$
declare
  version_id uuid;
  version_status text;
begin
  if tg_op = 'INSERT' then
    version_id := new.form_version_id;
  else
    version_id := old.form_version_id;
  end if;
  select status into version_status from forms.form_version where id = version_id;
  if version_status = 'published' then
    raise exception 'children of published form version % are immutable', version_id;
  end if;
  if tg_op = 'UPDATE' then
    if new.form_version_id <> old.form_version_id then
      select status into version_status from forms.form_version where id = new.form_version_id;
      if version_status = 'published' then
        raise exception 'children of published form version % are immutable', new.form_version_id;
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger form_locale_immutable before insert or update or delete on forms.form_locale
for each row execute function forms.prevent_published_form_child_mutation();
create trigger form_section_immutable before insert or update or delete on forms.form_section
for each row execute function forms.prevent_published_form_child_mutation();
create trigger form_field_immutable before insert or update or delete on forms.form_field
for each row execute function forms.prevent_published_form_child_mutation();
create trigger form_rule_immutable before insert or update or delete on forms.form_rule
for each row execute function forms.prevent_published_form_child_mutation();
create trigger publication_validation_immutable before insert or update or delete on forms.publication_validation
for each row execute function forms.prevent_published_form_child_mutation();

create table clinical.incident (
  id uuid primary key check (substring(id::text from 15 for 1) = '4' and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  organization_id uuid not null references app_identity.organization(id),
  operational_state text not null default 'created',
  dispatch_provenance jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  synthetic boolean not null default false,
  baseline boolean not null default false
);

create table clinical.patient (
  id uuid primary key check (substring(id::text from 15 for 1) = '4' and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  organization_id uuid not null references app_identity.organization(id),
  identity_state text not null check (identity_state in ('known', 'unknown', 'temporary', 'unavailable')),
  pseudonymous_key text not null check (pseudonymous_key ~ '^[a-f0-9]{64}$'),
  pseudonymous_key_version integer not null default 1 check (pseudonymous_key_version >= 1),
  created_at timestamptz not null default now(),
  unique (organization_id, pseudonymous_key)
);

create table clinical.report (
  id uuid primary key check (substring(id::text from 15 for 1) = '4' and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  organization_id uuid not null references app_identity.organization(id),
  incident_id uuid not null references clinical.incident(id),
  patient_id uuid not null references clinical.patient(id),
  agency_demographic_version_id uuid not null,
  form_version_id uuid not null references forms.form_version(id),
  catalog_release_id uuid not null references catalog.release(id),
  documenting_user_id uuid not null references app_identity.app_user(id),
  status text not null default 'draft' check (status in ('draft', 'signed')),
  revision bigint not null default 0 check (revision >= 0),
  reporting_date date,
  reporting_date_source text check (reporting_date_source in ('service-date', 'earliest-clinical-time', 'earliest-server-time', 'signing-time')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz,
  synthetic boolean not null default false,
  baseline boolean not null default false,
  check ((status = 'draft') or (reporting_date is not null and reporting_date_source is not null)),
  unique (id, catalog_release_id),
  foreign key (organization_id, agency_demographic_version_id, catalog_release_id)
    references app_identity.agency_demographic_version(organization_id, id, catalog_release_id)
);

create index report_incident_idx on clinical.report (incident_id);
create index report_patient_idx on clinical.report (patient_id);
create index report_status_updated_idx on clinical.report (status, updated_at);

create table clinical.report_contributor (
  report_id uuid not null references clinical.report(id) on delete cascade,
  user_id uuid not null references app_identity.app_user(id),
  contribution_kind text not null,
  added_at timestamptz not null default now(),
  primary key (report_id, user_id, contribution_kind)
);

create table clinical.group_instance (
  id uuid primary key check (substring(id::text from 15 for 1) = '4' and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  report_id uuid not null references clinical.report(id) on delete cascade,
  catalog_release_id uuid not null,
  parent_group_instance_id uuid,
  group_id text not null,
  source_kind text not null default 'nemsis' check (source_kind in ('nemsis', 'custom')),
  custom_group_definition_id uuid references forms.custom_group_definition(id),
  ordinal integer not null check (ordinal >= 0),
  correlation_id text check (correlation_id is null or length(correlation_id) between 2 and 255),
  documented_time timestamptz,
  documented_utc_offset_minutes smallint,
  server_received_time timestamptz not null default now(),
  tombstoned_at timestamptz,
  created_by uuid not null references app_identity.app_user(id),
  unique nulls not distinct (report_id, parent_group_instance_id, group_id, ordinal),
  unique (report_id, id),
  foreign key (report_id, catalog_release_id) references clinical.report(id, catalog_release_id),
  foreign key (report_id, parent_group_instance_id)
    references clinical.group_instance(report_id, id),
  check (
    (source_kind = 'nemsis' and custom_group_definition_id is null)
    or (source_kind = 'custom' and custom_group_definition_id is not null)
  )
);

create function clinical.validate_group_instance_mapping()
returns trigger
language plpgsql
as $$
declare
  custom_group forms.custom_group_definition%rowtype;
  report_organization_id uuid;
begin
  if new.source_kind = 'nemsis' then
    if not exists (
      select 1 from catalog.group_definition
      where release_id = new.catalog_release_id and group_id = new.group_id
    ) then
      raise exception 'group % does not belong to catalog release %', new.group_id, new.catalog_release_id;
    end if;
  else
    select * into custom_group from forms.custom_group_definition where id = new.custom_group_definition_id;
    if not found then raise exception 'custom group % is not defined', new.custom_group_definition_id; end if;
    select organization_id into report_organization_id from clinical.report where id = new.report_id;
    if not found or custom_group.organization_id <> report_organization_id then
      raise exception 'custom group % does not belong to report organization', new.custom_group_definition_id;
    end if;
    if new.group_id <> custom_group.namespace || '.' || custom_group.slug then
      raise exception 'custom group key % does not match definition %', new.group_id, new.custom_group_definition_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger group_instance_mapping_validate
before insert or update of catalog_release_id, group_id, source_kind, custom_group_definition_id
on clinical.group_instance
for each row execute function clinical.validate_group_instance_mapping();

create table clinical.element_occurrence (
  id uuid primary key check (substring(id::text from 15 for 1) = '4' and substring(id::text from 20 for 1) in ('8', '9', 'a', 'b')),
  report_id uuid not null references clinical.report(id) on delete cascade,
  catalog_release_id uuid not null,
  group_instance_id uuid,
  element_identity_id uuid not null references catalog.element_identity(id),
  element_id text not null,
  form_field_id uuid references forms.form_field(id),
  ordinal integer not null default 0 check (ordinal >= 0),
  analytical_repeatable boolean not null,
  identifying boolean not null default false,
  value_kind text not null check (value_kind in ('text', 'integer', 'numeric', 'boolean', 'date', 'datetime', 'time', 'duration', 'binary', 'uri', 'coded', 'null', 'pertinent-negative', 'absent')),
  value_text text,
  value_integer bigint,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  value_datetime timestamptz,
  value_time time,
  value_duration interval,
  value_binary bytea,
  value_lexical text,
  value_utc_offset_minutes smallint,
  value_precision text,
  code text,
  code_system text,
  code_display text,
  terminology_version text,
  absence_code text,
  absence_display text,
  source_attributes jsonb,
  correlation_id text check (correlation_id is null or length(correlation_id) between 2 and 255),
  provenance_kind text not null default 'clinician',
  provenance_detail jsonb,
  documented_time timestamptz,
  documented_utc_offset_minutes smallint,
  documented_precision text,
  server_received_time timestamptz not null default now(),
  author_id uuid not null references app_identity.app_user(id),
  tombstoned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (report_id, group_instance_id, element_identity_id, ordinal),
  foreign key (report_id, catalog_release_id) references clinical.report(id, catalog_release_id),
  foreign key (report_id, group_instance_id) references clinical.group_instance(report_id, id),
  check (source_attributes is null or source_attributes <> '{}'::jsonb),
  check (code is not null or num_nonnulls(code_system, code_display, terminology_version) = 0),
  check (absence_code is not null or absence_display is null),
  check (value_kind in ('integer', 'numeric', 'duration') or value_lexical is null),
  check (value_kind in ('date', 'datetime', 'time') or value_precision is null),
  check (value_kind in ('datetime', 'time') or value_utc_offset_minutes is null),
  check (
    (value_kind in ('text', 'uri') and value_text is not null and num_nonnulls(value_integer, value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'integer' and value_integer is not null and num_nonnulls(value_text, value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'numeric' and value_numeric is not null and num_nonnulls(value_text, value_integer, value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'boolean' and value_boolean is not null and num_nonnulls(value_text, value_integer, value_numeric, value_date, value_datetime, value_time, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'date' and value_date is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_datetime, value_time, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'datetime' and value_datetime is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_time, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'time' and value_time is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime, value_duration, value_binary, code, absence_code) = 0)
    or (value_kind = 'duration' and value_duration is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime, value_time, value_binary, code, absence_code) = 0)
    or (value_kind = 'binary' and value_binary is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration, code, absence_code) = 0)
    or (value_kind = 'coded' and code is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, absence_code) = 0)
    or (value_kind in ('null', 'pertinent-negative') and absence_code is not null and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, code) = 0)
    or (value_kind = 'absent' and num_nonnulls(value_text, value_integer, value_numeric, value_boolean, value_date, value_datetime, value_time, value_duration, value_binary, code) = 0)
  )
);

create index element_occurrence_report_idx on clinical.element_occurrence (report_id, group_instance_id, element_identity_id) where tombstoned_at is null;
create index element_occurrence_element_idx on clinical.element_occurrence (element_identity_id, report_id) where tombstoned_at is null;

create function clinical.validate_element_occurrence_mapping()
returns trigger
language plpgsql
as $$
declare
  identity_namespace text;
  standard_mapping catalog.analytics_element_mapping%rowtype;
  custom_definition forms.custom_element_definition%rowtype;
  custom_repeatable boolean;
begin
  select namespace into identity_namespace from catalog.element_identity where id = new.element_identity_id;
  if new.form_field_id is not null and not exists (
    select 1
    from forms.form_field field
    join clinical.report report on report.form_version_id = field.form_version_id
    where field.id = new.form_field_id and report.id = new.report_id
  ) then
    raise exception 'form field % does not belong to report % form version', new.form_field_id, new.report_id;
  end if;
  if identity_namespace = 'NEMSIS' then
    select * into standard_mapping
    from catalog.analytics_element_mapping
    where release_id = new.catalog_release_id and element_id = new.element_id;
    if not found or standard_mapping.element_identity_id <> new.element_identity_id then
      raise exception 'element % does not belong to catalog release %', new.element_id, new.catalog_release_id;
    end if;
    if (standard_mapping.analytical_location = 'repeatable') <> new.analytical_repeatable then
      raise exception 'analytical repeatability for % does not match the catalog mapping', new.element_id;
    end if;
    if standard_mapping.identifying <> new.identifying then
      raise exception 'identifying classification for % does not match the catalog mapping', new.element_id;
    end if;
  else
    select * into custom_definition from forms.custom_element_definition where id = new.element_identity_id;
    if not found then raise exception 'custom element identity % is not defined', new.element_identity_id; end if;
    if new.element_id <> custom_definition.namespace || '.' || custom_definition.slug then
      raise exception 'custom element key % does not match identity %', new.element_id, new.element_identity_id;
    end if;
    if new.identifying <> custom_definition.identifying then
      raise exception 'identifying classification for custom element % does not match its definition', new.element_id;
    end if;
    if new.form_field_id is null then raise exception 'custom element % requires a form field', new.element_id; end if;
    select analytical_repeatable into custom_repeatable from forms.form_field where id = new.form_field_id;
    if custom_repeatable <> new.analytical_repeatable then
      raise exception 'analytical repeatability for custom element % does not match its form field', new.element_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger element_occurrence_mapping_validate
before insert or update of catalog_release_id, element_identity_id, element_id, analytical_repeatable, identifying
on clinical.element_occurrence
for each row execute function clinical.validate_element_occurrence_mapping();

create table clinical.report_change (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references clinical.report(id) on delete cascade,
  revision bigint not null check (revision > 0),
  idempotency_key uuid not null check (substring(idempotency_key::text from 15 for 1) = '4' and substring(idempotency_key::text from 20 for 1) in ('8', '9', 'a', 'b')),
  author_id uuid not null references app_identity.app_user(id),
  device_id text,
  client_time timestamptz,
  server_received_time timestamptz not null default now(),
  changes jsonb not null,
  unique (report_id, revision),
  unique (report_id, idempotency_key)
);

create trigger report_change_append_only before update or delete on clinical.report_change
for each row execute function public.prevent_update_or_delete();

create table clinical.validation_finding (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references clinical.report(id) on delete cascade,
  revision bigint not null,
  severity text not null check (severity in ('error', 'warning')),
  code text not null,
  path text not null,
  message text not null,
  rule_version text not null,
  acknowledged_by uuid references app_identity.app_user(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table clinical.signed_snapshot (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references clinical.report(id),
  signed_revision bigint not null,
  form_version_id uuid not null references forms.form_version(id),
  catalog_release_id uuid not null references catalog.release(id),
  signer_id uuid not null references app_identity.app_user(id),
  signed_at timestamptz not null default now(),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[a-f0-9]{64}$'),
  attestation jsonb not null,
  warning_acknowledgements jsonb,
  unique (report_id, signed_revision)
);

create function clinical.validate_signed_snapshot()
returns trigger
language plpgsql
as $$
declare
  source_report clinical.report%rowtype;
begin
  select * into source_report from clinical.report where id = new.report_id for update;
  if not found then raise exception 'report % does not exist', new.report_id; end if;
  if source_report.status <> 'signed' then raise exception 'report % must be marked signed first', new.report_id; end if;
  if source_report.revision <> new.signed_revision then raise exception 'signed revision does not match report revision'; end if;
  if source_report.form_version_id <> new.form_version_id then raise exception 'signed form version does not match report'; end if;
  if source_report.catalog_release_id <> new.catalog_release_id then raise exception 'signed catalog release does not match report'; end if;
  if source_report.documenting_user_id <> new.signer_id then raise exception 'only the documenting clinician may sign'; end if;
  return new;
end;
$$;

create trigger signed_snapshot_validate before insert on clinical.signed_snapshot
for each row execute function clinical.validate_signed_snapshot();

create function clinical.require_signed_snapshot()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'signed' and not exists (
    select 1 from clinical.signed_snapshot snapshot where snapshot.report_id = new.id
  ) then
    raise exception 'signed report % requires a signed snapshot in the same transaction', new.id;
  end if;
  return new;
end;
$$;

create constraint trigger report_requires_signed_snapshot
after insert or update of status on clinical.report
deferrable initially deferred
for each row execute function clinical.require_signed_snapshot();

create trigger signed_snapshot_append_only before update or delete on clinical.signed_snapshot
for each row execute function public.prevent_update_or_delete();

create table clinical.amendment (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references clinical.report(id),
  sequence integer not null check (sequence > 0),
  author_id uuid not null references app_identity.app_user(id),
  reason text not null check (length(btrim(reason)) > 0),
  attestation jsonb not null check (jsonb_typeof(attestation) = 'object' and attestation <> '{}'::jsonb),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[a-f0-9]{64}$'),
  signed_at timestamptz not null default now(),
  reporting_date date,
  reporting_date_source text check (reporting_date_source in ('service-date', 'earliest-clinical-time', 'earliest-server-time', 'signing-time')),
  check ((reporting_date is null) = (reporting_date_source is null)),
  unique (report_id, sequence)
);

create function clinical.validate_amendment()
returns trigger
language plpgsql
as $$
declare
  report_status text;
  report_organization_id uuid;
  next_sequence integer;
begin
  select status, organization_id into report_status, report_organization_id
  from clinical.report where id = new.report_id for update;
  if report_status <> 'signed' then raise exception 'only a signed report may be amended'; end if;
  if not exists (select 1 from app_identity.app_user
      where id = new.author_id and organization_id = report_organization_id and active) then
    raise exception 'amendment author must be an active user in the report organization';
  end if;
  select coalesce(max(sequence), 0) + 1 into next_sequence from clinical.amendment where report_id = new.report_id;
  if new.sequence <> next_sequence then raise exception 'amendment sequence must be %, received %', next_sequence, new.sequence; end if;
  return new;
end;
$$;

create trigger amendment_validate before insert on clinical.amendment
for each row execute function clinical.validate_amendment();

create table clinical.amendment_change (
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references clinical.amendment(id) on delete cascade,
  action text not null check (action in ('add', 'replace', 'remove')),
  target_element_occurrence_id uuid,
  target_path jsonb not null,
  original_value jsonb,
  corrected_value jsonb,
  check (jsonb_typeof(target_path) = 'object'),
  check (original_value is null or jsonb_typeof(original_value) = 'object'),
  check (corrected_value is null or jsonb_typeof(corrected_value) = 'object'),
  check (
    (action = 'add' and target_element_occurrence_id is null and original_value is null and corrected_value is not null)
    or (action = 'replace' and target_element_occurrence_id is not null and original_value is not null and corrected_value is not null)
    or (action = 'remove' and target_element_occurrence_id is not null and original_value is not null and corrected_value is null)
  )
);

create trigger amendment_append_only before update or delete on clinical.amendment
for each row execute function public.prevent_update_or_delete();
create trigger amendment_change_append_only before update or delete on clinical.amendment_change
for each row execute function public.prevent_update_or_delete();

create function clinical.prevent_signed_report_mutation()
returns trigger
language plpgsql
as $$
declare
  parent_report_id uuid;
  parent_status text;
begin
  if tg_table_name = 'report' then
    if old.status = 'signed' then
      raise exception 'signed report % is immutable; create an amendment', old.id;
    end if;
    if tg_op = 'DELETE' and exists (select 1 from clinical.signed_snapshot where report_id = old.id) then
      raise exception 'signed report % cannot be deleted', old.id;
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  parent_report_id := case when tg_op = 'DELETE' then old.report_id else new.report_id end;
  select status into parent_status from clinical.report where id = parent_report_id;
  if parent_status = 'signed' then
    raise exception 'content of signed report % is immutable; create an amendment', parent_report_id;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create trigger report_signed_immutable before update or delete on clinical.report
for each row execute function clinical.prevent_signed_report_mutation();
create trigger group_instance_signed_immutable before insert or update or delete on clinical.group_instance
for each row execute function clinical.prevent_signed_report_mutation();
create trigger element_occurrence_signed_immutable before insert or update or delete on clinical.element_occurrence
for each row execute function clinical.prevent_signed_report_mutation();

create table clinical.command_receipt (
  idempotency_key uuid primary key check (substring(idempotency_key::text from 15 for 1) = '4' and substring(idempotency_key::text from 20 for 1) in ('8', '9', 'a', 'b')),
  report_id uuid references clinical.report(id) on delete cascade,
  command_type text not null,
  request_sha256 text not null check (request_sha256 ~ '^[a-f0-9]{64}$'),
  response_status integer not null,
  response_body jsonb,
  received_at timestamptz not null default now()
);

create trigger command_receipt_append_only before update or delete on clinical.command_receipt
for each row execute function public.prevent_update_or_delete();

create table clinical_audit.event (
  id bigint generated always as identity primary key,
  report_id uuid references clinical.report(id),
  report_sequence bigint,
  actor_id uuid references app_identity.app_user(id),
  actor_persona text,
  session_id text,
  device_id text,
  client_time timestamptz,
  server_time timestamptz not null default now(),
  action text not null,
  target_type text not null,
  target_id text not null,
  prior_value jsonb,
  new_value jsonb,
  previous_hash text check (previous_hash is null or previous_hash ~ '^[a-f0-9]{64}$'),
  event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
  unique (report_id, report_sequence),
  check ((report_id is null and report_sequence is null) or (report_id is not null and report_sequence is not null))
);

create function clinical_audit.validate_report_chain()
returns trigger
language plpgsql
as $$
declare
  prior_sequence bigint;
  prior_event_hash text;
begin
  if new.report_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.report_id::text, 0));
  select report_sequence, event_hash
    into prior_sequence, prior_event_hash
  from clinical_audit.event
  where report_id = new.report_id
  order by report_sequence desc
  limit 1;
  if prior_sequence is null then
    if new.report_sequence <> 1 or new.previous_hash is not null then
      raise exception 'first report audit event must have sequence 1 and no previous hash';
    end if;
  elsif new.report_sequence <> prior_sequence + 1 or new.previous_hash is distinct from prior_event_hash then
    raise exception 'audit event does not continue report % hash chain', new.report_id;
  end if;
  return new;
end;
$$;

create trigger audit_event_chain_validate before insert on clinical_audit.event
for each row execute function clinical_audit.validate_report_chain();

create trigger audit_event_append_only before update or delete on clinical_audit.event
for each row execute function public.prevent_update_or_delete();

create table integration.outbox_event (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  processed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text,
  unique (aggregate_type, aggregate_id, event_type, occurred_at)
);

create index outbox_pending_idx on integration.outbox_event (available_at, occurred_at) where processed_at is null;

create table integration.projection_backfill_job (
  id text primary key check (length(btrim(id)) between 1 and 200),
  report_id uuid references clinical.report(id),
  start_date date,
  end_date date,
  cursor_reporting_date date,
  cursor_report_id uuid,
  processed_count integer not null default 0 check (processed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (report_id is not null and start_date is null and end_date is null)
    or (report_id is null and start_date is not null and end_date is not null and start_date <= end_date)
  ),
  check ((cursor_reporting_date is null) = (cursor_report_id is null))
);

create function integration.enqueue_report_projection()
returns trigger
language plpgsql
as $$
begin
  insert into integration.outbox_event (aggregate_type, aggregate_id, event_type, payload)
  values ('report', new.report_id, tg_table_name, jsonb_build_object('sourceId', new.id));
  return new;
end;
$$;

create trigger signed_snapshot_projection_event after insert on clinical.signed_snapshot
for each row execute function integration.enqueue_report_projection();
create trigger amendment_projection_event after insert on clinical.amendment
for each row execute function integration.enqueue_report_projection();

create table analytics_private.epcr (
  reporting_date date not null,
  reporting_date_source text not null,
  report_id uuid not null,
  incident_id uuid not null,
  organization_id uuid not null,
  agency_demographic_version_id uuid not null,
  patient_key text not null,
  patient_key_version integer not null,
  form_version_id uuid not null,
  form_version integer not null,
  catalog_release_id uuid not null,
  catalog_version text not null,
  signed_snapshot_id uuid not null,
  signed_snapshot_sha256 text not null,
  signed_at timestamptz not null,
  last_amended_at timestamptz,
  amendment_count integer not null default 0,
  effective_amendment_sequence integer not null default 0,
  projector_version text not null,
  projected_at timestamptz not null,
  element_statuses jsonb,
  additional_elements jsonb,
  additional_identifying_elements jsonb,
  quality_flags text[],
  quality_rule_version text,
  -- BEGIN GENERATED NEMSIS WIDE COLUMNS
  eairway_10 timestamptz,
  eairway_10_precision text,
  eairway_10_utc_offset_minutes smallint,
  eairway_11 timestamptz,
  eairway_11_precision text,
  eairway_11_utc_offset_minutes smallint,
  earrest_01 text,
  earrest_01_display text,
  earrest_01_system text,
  earrest_01_terminology_version text,
  earrest_02 text,
  earrest_02_display text,
  earrest_02_system text,
  earrest_02_terminology_version text,
  earrest_07 text,
  earrest_07_display text,
  earrest_07_system text,
  earrest_07_terminology_version text,
  earrest_10 text,
  earrest_10_display text,
  earrest_10_system text,
  earrest_10_terminology_version text,
  earrest_11 text,
  earrest_11_display text,
  earrest_11_system text,
  earrest_11_terminology_version text,
  earrest_13 text,
  earrest_13_display text,
  earrest_13_system text,
  earrest_13_terminology_version text,
  earrest_14 timestamptz,
  earrest_14_precision text,
  earrest_14_utc_offset_minutes smallint,
  earrest_15 timestamptz,
  earrest_15_precision text,
  earrest_15_utc_offset_minutes smallint,
  earrest_16 text,
  earrest_16_display text,
  earrest_16_system text,
  earrest_16_terminology_version text,
  earrest_18 text,
  earrest_18_display text,
  earrest_18_system text,
  earrest_18_terminology_version text,
  earrest_19 timestamptz,
  earrest_19_precision text,
  earrest_19_utc_offset_minutes smallint,
  earrest_20 text,
  earrest_20_display text,
  earrest_20_system text,
  earrest_20_terminology_version text,
  earrest_21 text,
  earrest_21_display text,
  earrest_21_system text,
  earrest_21_terminology_version text,
  earrest_22 text,
  earrest_22_display text,
  earrest_22_system text,
  earrest_22_terminology_version text,
  edispatch_01 text,
  edispatch_01_display text,
  edispatch_01_system text,
  edispatch_01_terminology_version text,
  edispatch_02 text,
  edispatch_02_display text,
  edispatch_02_system text,
  edispatch_02_terminology_version text,
  edispatch_03 text,
  edispatch_04 text,
  edispatch_05 text,
  edispatch_05_display text,
  edispatch_05_system text,
  edispatch_05_terminology_version text,
  edispatch_06 text,
  edisposition_01 text,
  edisposition_02 text,
  edisposition_03 text,
  edisposition_04 text,
  edisposition_04_display text,
  edisposition_04_system text,
  edisposition_04_terminology_version text,
  edisposition_05 text,
  edisposition_05_display text,
  edisposition_05_system text,
  edisposition_05_terminology_version text,
  edisposition_06 text,
  edisposition_06_display text,
  edisposition_06_system text,
  edisposition_06_terminology_version text,
  edisposition_07 text,
  edisposition_08 text,
  edisposition_08_display text,
  edisposition_08_system text,
  edisposition_08_terminology_version text,
  edisposition_09 text,
  edisposition_10 text,
  edisposition_11 bigint,
  edisposition_11_lexical text,
  edisposition_16 text,
  edisposition_16_display text,
  edisposition_16_system text,
  edisposition_16_terminology_version text,
  edisposition_17 text,
  edisposition_17_display text,
  edisposition_17_system text,
  edisposition_17_terminology_version text,
  edisposition_19 text,
  edisposition_19_display text,
  edisposition_19_system text,
  edisposition_19_terminology_version text,
  edisposition_21 text,
  edisposition_21_display text,
  edisposition_21_system text,
  edisposition_21_terminology_version text,
  edisposition_22 text,
  edisposition_22_display text,
  edisposition_22_system text,
  edisposition_22_terminology_version text,
  edisposition_27 text,
  edisposition_27_display text,
  edisposition_27_system text,
  edisposition_27_terminology_version text,
  edisposition_28 text,
  edisposition_28_display text,
  edisposition_28_system text,
  edisposition_28_terminology_version text,
  edisposition_29 text,
  edisposition_29_display text,
  edisposition_29_system text,
  edisposition_29_terminology_version text,
  edisposition_30 text,
  edisposition_30_display text,
  edisposition_30_system text,
  edisposition_30_terminology_version text,
  edisposition_32 text,
  edisposition_32_display text,
  edisposition_32_system text,
  edisposition_32_terminology_version text,
  eexam_01 numeric,
  eexam_01_lexical text,
  eexam_02 text,
  eexam_02_display text,
  eexam_02_system text,
  eexam_02_terminology_version text,
  eexam_21 text,
  eexam_21_display text,
  eexam_21_system text,
  eexam_21_terminology_version text,
  ehistory_16 text,
  ehistory_16_display text,
  ehistory_16_system text,
  ehistory_16_terminology_version text,
  ehistory_18 text,
  ehistory_18_display text,
  ehistory_18_system text,
  ehistory_18_terminology_version text,
  ehistory_19 timestamptz,
  ehistory_19_precision text,
  ehistory_19_utc_offset_minutes smallint,
  einjury_05 bigint,
  einjury_05_lexical text,
  einjury_06 text,
  einjury_06_display text,
  einjury_06_system text,
  einjury_06_terminology_version text,
  einjury_09 bigint,
  einjury_09_lexical text,
  einjury_11 text,
  einjury_12 text,
  einjury_14 timestamptz,
  einjury_14_precision text,
  einjury_14_utc_offset_minutes smallint,
  einjury_15 text,
  einjury_16 text,
  einjury_17 text,
  einjury_18 text,
  einjury_19 text,
  einjury_20 bigint,
  einjury_20_lexical text,
  einjury_21 text,
  einjury_21_display text,
  einjury_21_system text,
  einjury_21_terminology_version text,
  einjury_23 text,
  einjury_23_display text,
  einjury_23_system text,
  einjury_23_terminology_version text,
  einjury_24 bigint,
  einjury_24_lexical text,
  einjury_25 text,
  einjury_25_display text,
  einjury_25_system text,
  einjury_25_terminology_version text,
  enarrative_01 text,
  eother_01 text,
  eother_01_display text,
  eother_01_system text,
  eother_01_terminology_version text,
  eother_08 text,
  eoutcome_01 text,
  eoutcome_01_display text,
  eoutcome_01_system text,
  eoutcome_01_terminology_version text,
  eoutcome_02 text,
  eoutcome_02_display text,
  eoutcome_02_system text,
  eoutcome_02_terminology_version text,
  eoutcome_11 timestamptz,
  eoutcome_11_precision text,
  eoutcome_11_utc_offset_minutes smallint,
  eoutcome_16 timestamptz,
  eoutcome_16_precision text,
  eoutcome_16_utc_offset_minutes smallint,
  eoutcome_18 timestamptz,
  eoutcome_18_precision text,
  eoutcome_18_utc_offset_minutes smallint,
  eoutcome_21 bigint,
  eoutcome_21_lexical text,
  epatient_01 text,
  epatient_02 text,
  epatient_03 text,
  epatient_04 text,
  epatient_05 text,
  epatient_06 text,
  epatient_06_display text,
  epatient_06_system text,
  epatient_06_terminology_version text,
  epatient_07 text,
  epatient_07_display text,
  epatient_07_system text,
  epatient_07_terminology_version text,
  epatient_08 text,
  epatient_08_display text,
  epatient_08_system text,
  epatient_08_terminology_version text,
  epatient_09 text,
  epatient_10 text,
  epatient_10_display text,
  epatient_10_system text,
  epatient_10_terminology_version text,
  epatient_11 text,
  epatient_11_display text,
  epatient_11_system text,
  epatient_11_terminology_version text,
  epatient_12 text,
  epatient_13 text,
  epatient_13_display text,
  epatient_13_system text,
  epatient_13_terminology_version text,
  epatient_15 bigint,
  epatient_15_lexical text,
  epatient_16 text,
  epatient_16_display text,
  epatient_16_system text,
  epatient_16_terminology_version text,
  epatient_17 date,
  epatient_17_precision text,
  epatient_20 text,
  epatient_20_display text,
  epatient_20_system text,
  epatient_20_terminology_version text,
  epatient_21 text,
  epatient_22 text,
  epatient_22_display text,
  epatient_22_system text,
  epatient_22_terminology_version text,
  epatient_23 text,
  epatient_25 text,
  epatient_25_display text,
  epatient_25_system text,
  epatient_25_terminology_version text,
  epayment_01 text,
  epayment_01_display text,
  epayment_01_system text,
  epayment_01_terminology_version text,
  epayment_02 text,
  epayment_02_display text,
  epayment_02_system text,
  epayment_02_terminology_version text,
  epayment_03 timestamptz,
  epayment_03_precision text,
  epayment_03_utc_offset_minutes smallint,
  epayment_05 text,
  epayment_05_display text,
  epayment_05_system text,
  epayment_05_terminology_version text,
  epayment_06 text,
  epayment_07 text,
  epayment_08 text,
  epayment_08_display text,
  epayment_08_system text,
  epayment_08_terminology_version text,
  epayment_23 text,
  epayment_24 text,
  epayment_25 text,
  epayment_26 text,
  epayment_27 text,
  epayment_27_display text,
  epayment_27_system text,
  epayment_27_terminology_version text,
  epayment_28 text,
  epayment_28_display text,
  epayment_28_system text,
  epayment_28_terminology_version text,
  epayment_29 text,
  epayment_30 text,
  epayment_30_display text,
  epayment_30_system text,
  epayment_30_terminology_version text,
  epayment_32 text,
  epayment_32_display text,
  epayment_32_system text,
  epayment_32_terminology_version text,
  epayment_33 text,
  epayment_34 text,
  epayment_35 text,
  epayment_35_display text,
  epayment_35_system text,
  epayment_35_terminology_version text,
  epayment_36 text,
  epayment_36_display text,
  epayment_36_system text,
  epayment_36_terminology_version text,
  epayment_37 text,
  epayment_38 text,
  epayment_38_display text,
  epayment_38_system text,
  epayment_38_terminology_version text,
  epayment_39 text,
  epayment_40 text,
  epayment_40_display text,
  epayment_40_system text,
  epayment_40_terminology_version text,
  epayment_45 text,
  epayment_46 text,
  epayment_48 numeric,
  epayment_48_lexical text,
  epayment_49 text,
  epayment_49_display text,
  epayment_49_system text,
  epayment_49_terminology_version text,
  epayment_50 text,
  epayment_50_display text,
  epayment_50_system text,
  epayment_50_terminology_version text,
  epayment_53 text,
  epayment_54 text,
  epayment_57 text,
  epayment_57_display text,
  epayment_57_system text,
  epayment_57_terminology_version text,
  erecord_01 text,
  erecord_02 text,
  erecord_03 text,
  erecord_04 text,
  eresponse_01 text,
  eresponse_02 text,
  eresponse_03 text,
  eresponse_04 text,
  eresponse_05 text,
  eresponse_05_display text,
  eresponse_05_system text,
  eresponse_05_terminology_version text,
  eresponse_06 text,
  eresponse_06_display text,
  eresponse_06_system text,
  eresponse_06_terminology_version text,
  eresponse_07 text,
  eresponse_07_display text,
  eresponse_07_system text,
  eresponse_07_terminology_version text,
  eresponse_13 text,
  eresponse_14 text,
  eresponse_16 text,
  eresponse_17 text,
  eresponse_18 text,
  eresponse_19 numeric,
  eresponse_19_lexical text,
  eresponse_20 numeric,
  eresponse_20_lexical text,
  eresponse_21 numeric,
  eresponse_21_lexical text,
  eresponse_22 numeric,
  eresponse_22_lexical text,
  eresponse_23 text,
  eresponse_23_display text,
  eresponse_23_system text,
  eresponse_23_terminology_version text,
  escene_01 text,
  escene_01_display text,
  escene_01_system text,
  escene_01_terminology_version text,
  escene_05 timestamptz,
  escene_05_precision text,
  escene_05_utc_offset_minutes smallint,
  escene_06 text,
  escene_06_display text,
  escene_06_system text,
  escene_06_terminology_version text,
  escene_07 text,
  escene_07_display text,
  escene_07_system text,
  escene_07_terminology_version text,
  escene_08 text,
  escene_08_display text,
  escene_08_system text,
  escene_08_terminology_version text,
  escene_09 text,
  escene_09_display text,
  escene_09_system text,
  escene_09_terminology_version text,
  escene_10 text,
  escene_11 text,
  escene_12 text,
  escene_13 text,
  escene_14 text,
  escene_15 text,
  escene_16 text,
  escene_17 text,
  escene_17_display text,
  escene_17_system text,
  escene_17_terminology_version text,
  escene_18 text,
  escene_18_display text,
  escene_18_system text,
  escene_18_terminology_version text,
  escene_19 text,
  escene_20 text,
  escene_21 text,
  escene_21_display text,
  escene_21_system text,
  escene_21_terminology_version text,
  escene_22 text,
  escene_22_display text,
  escene_22_system text,
  escene_22_terminology_version text,
  escene_23 text,
  escene_23_display text,
  escene_23_system text,
  escene_23_terminology_version text,
  esituation_01 timestamptz,
  esituation_01_precision text,
  esituation_01_utc_offset_minutes smallint,
  esituation_02 text,
  esituation_02_display text,
  esituation_02_system text,
  esituation_02_terminology_version text,
  esituation_07 text,
  esituation_07_display text,
  esituation_07_system text,
  esituation_07_terminology_version text,
  esituation_08 text,
  esituation_08_display text,
  esituation_08_system text,
  esituation_08_terminology_version text,
  esituation_09 text,
  esituation_09_display text,
  esituation_09_system text,
  esituation_09_terminology_version text,
  esituation_11 text,
  esituation_11_display text,
  esituation_11_system text,
  esituation_11_terminology_version text,
  esituation_13 text,
  esituation_13_display text,
  esituation_13_system text,
  esituation_13_terminology_version text,
  esituation_14 text,
  esituation_14_display text,
  esituation_14_system text,
  esituation_14_terminology_version text,
  esituation_15 text,
  esituation_15_display text,
  esituation_15_system text,
  esituation_15_terminology_version text,
  esituation_16 text,
  esituation_16_display text,
  esituation_16_system text,
  esituation_16_terminology_version text,
  esituation_18 timestamptz,
  esituation_18_precision text,
  esituation_18_utc_offset_minutes smallint,
  esituation_19 text,
  esituation_20 text,
  esituation_20_display text,
  esituation_20_system text,
  esituation_20_terminology_version text,
  etimes_01 timestamptz,
  etimes_01_precision text,
  etimes_01_utc_offset_minutes smallint,
  etimes_02 timestamptz,
  etimes_02_precision text,
  etimes_02_utc_offset_minutes smallint,
  etimes_03 timestamptz,
  etimes_03_precision text,
  etimes_03_utc_offset_minutes smallint,
  etimes_04 timestamptz,
  etimes_04_precision text,
  etimes_04_utc_offset_minutes smallint,
  etimes_05 timestamptz,
  etimes_05_precision text,
  etimes_05_utc_offset_minutes smallint,
  etimes_06 timestamptz,
  etimes_06_precision text,
  etimes_06_utc_offset_minutes smallint,
  etimes_07 timestamptz,
  etimes_07_precision text,
  etimes_07_utc_offset_minutes smallint,
  etimes_08 timestamptz,
  etimes_08_precision text,
  etimes_08_utc_offset_minutes smallint,
  etimes_09 timestamptz,
  etimes_09_precision text,
  etimes_09_utc_offset_minutes smallint,
  etimes_10 timestamptz,
  etimes_10_precision text,
  etimes_10_utc_offset_minutes smallint,
  etimes_11 timestamptz,
  etimes_11_precision text,
  etimes_11_utc_offset_minutes smallint,
  etimes_12 timestamptz,
  etimes_12_precision text,
  etimes_12_utc_offset_minutes smallint,
  etimes_13 timestamptz,
  etimes_13_precision text,
  etimes_13_utc_offset_minutes smallint,
  etimes_14 timestamptz,
  etimes_14_precision text,
  etimes_14_utc_offset_minutes smallint,
  etimes_15 timestamptz,
  etimes_15_precision text,
  etimes_15_utc_offset_minutes smallint,
  etimes_16 timestamptz,
  etimes_16_precision text,
  etimes_16_utc_offset_minutes smallint,
  etimes_17 timestamptz,
  etimes_17_precision text,
  etimes_17_utc_offset_minutes smallint,
  -- END GENERATED NEMSIS WIDE COLUMNS
  primary key (reporting_date, report_id),
  check (element_statuses is null or element_statuses <> '{}'::jsonb),
  check (additional_elements is null or additional_elements <> '{}'::jsonb),
  check (additional_identifying_elements is null or additional_identifying_elements <> '{}'::jsonb)
) partition by range (reporting_date);

create index analytics_epcr_report_id_idx on analytics_private.epcr (report_id);
create index analytics_epcr_incident_idx on analytics_private.epcr (incident_id);
create index analytics_epcr_patient_idx on analytics_private.epcr (patient_key, reporting_date);
create index analytics_epcr_agency_idx on analytics_private.epcr (eresponse_01, reporting_date);

create table analytics_private.epcr_repeatable_element (
  reporting_date date not null,
  reporting_date_source text not null,
  report_id uuid not null,
  incident_id uuid not null,
  organization_id uuid not null,
  agency_demographic_version_id uuid not null,
  patient_key text not null,
  patient_key_version integer not null,
  form_version_id uuid not null,
  catalog_release_id uuid not null,
  catalog_version text not null,
  element_identity_id uuid not null,
  element_id text not null,
  element_occurrence_id uuid not null,
  group_id text not null,
  group_instance_id uuid not null,
  parent_group_instance_id uuid,
  group_path text[] not null,
  instance_path uuid[] not null,
  group_ordinal integer not null,
  element_ordinal integer not null,
  correlation_id text,
  group_correlation_id text,
  value_kind text not null,
  value_text text,
  value_integer bigint,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  value_datetime timestamptz,
  value_time time,
  value_duration interval,
  value_binary bytea,
  value_lexical text,
  value_utc_offset_minutes smallint,
  value_precision text,
  code text,
  code_system text,
  code_display text,
  terminology_version text,
  absence_kind text,
  absence_code text,
  absence_display text,
  clinical_time timestamptz,
  clinical_time_element_id text,
  clinical_utc_offset_minutes smallint,
  clinical_time_precision text,
  documented_time timestamptz,
  documented_utc_offset_minutes smallint,
  documented_time_precision text,
  server_received_time timestamptz not null,
  normalized_numeric numeric,
  normalized_unit_code text,
  normalization_rule_version text,
  source_attributes jsonb,
  quality_flags text[],
  quality_rule_version text,
  is_identifying boolean not null,
  signed_snapshot_id uuid not null,
  signed_snapshot_sha256 text not null,
  effective_amendment_sequence integer not null default 0,
  projector_version text not null,
  projected_at timestamptz not null,
  primary key (reporting_date, report_id, element_occurrence_id),
  check (source_attributes is null or source_attributes <> '{}'::jsonb)
) partition by range (reporting_date);

create index analytics_repeat_report_group_idx on analytics_private.epcr_repeatable_element (report_id, group_instance_id, element_id);
create index analytics_repeat_element_time_idx on analytics_private.epcr_repeatable_element (element_id, clinical_time);
create index analytics_repeat_element_code_idx on analytics_private.epcr_repeatable_element (element_id, code) where code is not null;
create index analytics_repeat_reporting_date_brin_idx on analytics_private.epcr_repeatable_element using brin (reporting_date);

create function analytics_private.ensure_partitions(start_date date, end_date date)
returns void
language plpgsql
security definer
set search_path = pg_catalog, analytics_private
as $$
declare
  year_start date;
  month_start date;
begin
  if start_date is null or end_date is null or start_date >= end_date then
    raise exception 'invalid analytics partition range: % to %', start_date, end_date;
  end if;

  year_start := date_trunc('year', start_date)::date;
  while year_start < end_date loop
    execute format(
      'create table if not exists analytics_private.epcr_y%s partition of analytics_private.epcr for values from (%L) to (%L)',
      to_char(year_start, 'YYYY'), year_start, (year_start + interval '1 year')::date
    );
    year_start := (year_start + interval '1 year')::date;
  end loop;

  month_start := date_trunc('month', start_date)::date;
  while month_start < end_date loop
    execute format(
      'create table if not exists analytics_private.epcr_repeatable_element_m%s partition of analytics_private.epcr_repeatable_element for values from (%L) to (%L)',
      to_char(month_start, 'YYYYMM'), month_start, (month_start + interval '1 month')::date
    );
    month_start := (month_start + interval '1 month')::date;
  end loop;
end;
$$;

select analytics_private.ensure_partitions(
  (current_date - interval '10 years')::date,
  (current_date + interval '2 years')::date
);

create view analytics.epcr
with (security_barrier = true)
as
select
  -- BEGIN GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS
  reporting_date,
  reporting_date_source,
  report_id,
  incident_id,
  organization_id,
  agency_demographic_version_id,
  patient_key,
  patient_key_version,
  form_version_id,
  form_version,
  catalog_release_id,
  catalog_version,
  signed_snapshot_id,
  signed_snapshot_sha256,
  signed_at,
  last_amended_at,
  amendment_count,
  effective_amendment_sequence,
  projector_version,
  projected_at,
  element_statuses,
  additional_elements,
  quality_flags,
  quality_rule_version,
  eairway_10,
  eairway_10_precision,
  eairway_10_utc_offset_minutes,
  eairway_11,
  eairway_11_precision,
  eairway_11_utc_offset_minutes,
  earrest_01,
  earrest_01_display,
  earrest_01_system,
  earrest_01_terminology_version,
  earrest_02,
  earrest_02_display,
  earrest_02_system,
  earrest_02_terminology_version,
  earrest_07,
  earrest_07_display,
  earrest_07_system,
  earrest_07_terminology_version,
  earrest_10,
  earrest_10_display,
  earrest_10_system,
  earrest_10_terminology_version,
  earrest_11,
  earrest_11_display,
  earrest_11_system,
  earrest_11_terminology_version,
  earrest_13,
  earrest_13_display,
  earrest_13_system,
  earrest_13_terminology_version,
  earrest_14,
  earrest_14_precision,
  earrest_14_utc_offset_minutes,
  earrest_15,
  earrest_15_precision,
  earrest_15_utc_offset_minutes,
  earrest_16,
  earrest_16_display,
  earrest_16_system,
  earrest_16_terminology_version,
  earrest_18,
  earrest_18_display,
  earrest_18_system,
  earrest_18_terminology_version,
  earrest_19,
  earrest_19_precision,
  earrest_19_utc_offset_minutes,
  earrest_20,
  earrest_20_display,
  earrest_20_system,
  earrest_20_terminology_version,
  earrest_21,
  earrest_21_display,
  earrest_21_system,
  earrest_21_terminology_version,
  earrest_22,
  earrest_22_display,
  earrest_22_system,
  earrest_22_terminology_version,
  edispatch_01,
  edispatch_01_display,
  edispatch_01_system,
  edispatch_01_terminology_version,
  edispatch_02,
  edispatch_02_display,
  edispatch_02_system,
  edispatch_02_terminology_version,
  edispatch_03,
  edispatch_04,
  edispatch_05,
  edispatch_05_display,
  edispatch_05_system,
  edispatch_05_terminology_version,
  edispatch_06,
  edisposition_01,
  edisposition_02,
  edisposition_03,
  edisposition_04,
  edisposition_04_display,
  edisposition_04_system,
  edisposition_04_terminology_version,
  edisposition_05,
  edisposition_05_display,
  edisposition_05_system,
  edisposition_05_terminology_version,
  edisposition_06,
  edisposition_06_display,
  edisposition_06_system,
  edisposition_06_terminology_version,
  edisposition_07,
  edisposition_08,
  edisposition_08_display,
  edisposition_08_system,
  edisposition_08_terminology_version,
  edisposition_09,
  edisposition_10,
  edisposition_11,
  edisposition_11_lexical,
  edisposition_16,
  edisposition_16_display,
  edisposition_16_system,
  edisposition_16_terminology_version,
  edisposition_17,
  edisposition_17_display,
  edisposition_17_system,
  edisposition_17_terminology_version,
  edisposition_19,
  edisposition_19_display,
  edisposition_19_system,
  edisposition_19_terminology_version,
  edisposition_21,
  edisposition_21_display,
  edisposition_21_system,
  edisposition_21_terminology_version,
  edisposition_22,
  edisposition_22_display,
  edisposition_22_system,
  edisposition_22_terminology_version,
  edisposition_27,
  edisposition_27_display,
  edisposition_27_system,
  edisposition_27_terminology_version,
  edisposition_28,
  edisposition_28_display,
  edisposition_28_system,
  edisposition_28_terminology_version,
  edisposition_29,
  edisposition_29_display,
  edisposition_29_system,
  edisposition_29_terminology_version,
  edisposition_30,
  edisposition_30_display,
  edisposition_30_system,
  edisposition_30_terminology_version,
  edisposition_32,
  edisposition_32_display,
  edisposition_32_system,
  edisposition_32_terminology_version,
  eexam_01,
  eexam_01_lexical,
  eexam_02,
  eexam_02_display,
  eexam_02_system,
  eexam_02_terminology_version,
  eexam_21,
  eexam_21_display,
  eexam_21_system,
  eexam_21_terminology_version,
  ehistory_16,
  ehistory_16_display,
  ehistory_16_system,
  ehistory_16_terminology_version,
  ehistory_18,
  ehistory_18_display,
  ehistory_18_system,
  ehistory_18_terminology_version,
  ehistory_19,
  ehistory_19_precision,
  ehistory_19_utc_offset_minutes,
  einjury_05,
  einjury_05_lexical,
  einjury_06,
  einjury_06_display,
  einjury_06_system,
  einjury_06_terminology_version,
  einjury_09,
  einjury_09_lexical,
  einjury_11,
  einjury_12,
  einjury_14,
  einjury_14_precision,
  einjury_14_utc_offset_minutes,
  einjury_15,
  einjury_16,
  einjury_17,
  einjury_18,
  einjury_19,
  einjury_20,
  einjury_20_lexical,
  einjury_21,
  einjury_21_display,
  einjury_21_system,
  einjury_21_terminology_version,
  einjury_23,
  einjury_23_display,
  einjury_23_system,
  einjury_23_terminology_version,
  einjury_24,
  einjury_24_lexical,
  einjury_25,
  einjury_25_display,
  einjury_25_system,
  einjury_25_terminology_version,
  eother_01,
  eother_01_display,
  eother_01_system,
  eother_01_terminology_version,
  eoutcome_01,
  eoutcome_01_display,
  eoutcome_01_system,
  eoutcome_01_terminology_version,
  eoutcome_02,
  eoutcome_02_display,
  eoutcome_02_system,
  eoutcome_02_terminology_version,
  eoutcome_11,
  eoutcome_11_precision,
  eoutcome_11_utc_offset_minutes,
  eoutcome_16,
  eoutcome_16_precision,
  eoutcome_16_utc_offset_minutes,
  eoutcome_18,
  eoutcome_18_precision,
  eoutcome_18_utc_offset_minutes,
  eoutcome_21,
  eoutcome_21_lexical,
  epatient_06,
  epatient_06_display,
  epatient_06_system,
  epatient_06_terminology_version,
  epatient_07,
  epatient_07_display,
  epatient_07_system,
  epatient_07_terminology_version,
  epatient_08,
  epatient_08_display,
  epatient_08_system,
  epatient_08_terminology_version,
  epatient_09,
  epatient_10,
  epatient_10_display,
  epatient_10_system,
  epatient_10_terminology_version,
  epatient_11,
  epatient_11_display,
  epatient_11_system,
  epatient_11_terminology_version,
  epatient_12,
  epatient_13,
  epatient_13_display,
  epatient_13_system,
  epatient_13_terminology_version,
  epatient_15,
  epatient_15_lexical,
  epatient_16,
  epatient_16_display,
  epatient_16_system,
  epatient_16_terminology_version,
  epatient_20,
  epatient_20_display,
  epatient_20_system,
  epatient_20_terminology_version,
  epatient_22,
  epatient_22_display,
  epatient_22_system,
  epatient_22_terminology_version,
  epatient_25,
  epatient_25_display,
  epatient_25_system,
  epatient_25_terminology_version,
  epayment_01,
  epayment_01_display,
  epayment_01_system,
  epayment_01_terminology_version,
  epayment_02,
  epayment_02_display,
  epayment_02_system,
  epayment_02_terminology_version,
  epayment_03,
  epayment_03_precision,
  epayment_03_utc_offset_minutes,
  epayment_05,
  epayment_05_display,
  epayment_05_system,
  epayment_05_terminology_version,
  epayment_08,
  epayment_08_display,
  epayment_08_system,
  epayment_08_terminology_version,
  epayment_27,
  epayment_27_display,
  epayment_27_system,
  epayment_27_terminology_version,
  epayment_28,
  epayment_28_display,
  epayment_28_system,
  epayment_28_terminology_version,
  epayment_29,
  epayment_30,
  epayment_30_display,
  epayment_30_system,
  epayment_30_terminology_version,
  epayment_32,
  epayment_32_display,
  epayment_32_system,
  epayment_32_terminology_version,
  epayment_35,
  epayment_35_display,
  epayment_35_system,
  epayment_35_terminology_version,
  epayment_36,
  epayment_36_display,
  epayment_36_system,
  epayment_36_terminology_version,
  epayment_37,
  epayment_38,
  epayment_38_display,
  epayment_38_system,
  epayment_38_terminology_version,
  epayment_40,
  epayment_40_display,
  epayment_40_system,
  epayment_40_terminology_version,
  epayment_45,
  epayment_46,
  epayment_48,
  epayment_48_lexical,
  epayment_49,
  epayment_49_display,
  epayment_49_system,
  epayment_49_terminology_version,
  epayment_50,
  epayment_50_display,
  epayment_50_system,
  epayment_50_terminology_version,
  epayment_53,
  epayment_54,
  epayment_57,
  epayment_57_display,
  epayment_57_system,
  epayment_57_terminology_version,
  erecord_01,
  erecord_02,
  erecord_03,
  erecord_04,
  eresponse_01,
  eresponse_02,
  eresponse_03,
  eresponse_04,
  eresponse_05,
  eresponse_05_display,
  eresponse_05_system,
  eresponse_05_terminology_version,
  eresponse_06,
  eresponse_06_display,
  eresponse_06_system,
  eresponse_06_terminology_version,
  eresponse_07,
  eresponse_07_display,
  eresponse_07_system,
  eresponse_07_terminology_version,
  eresponse_13,
  eresponse_14,
  eresponse_16,
  eresponse_17,
  eresponse_18,
  eresponse_19,
  eresponse_19_lexical,
  eresponse_20,
  eresponse_20_lexical,
  eresponse_21,
  eresponse_21_lexical,
  eresponse_22,
  eresponse_22_lexical,
  eresponse_23,
  eresponse_23_display,
  eresponse_23_system,
  eresponse_23_terminology_version,
  escene_01,
  escene_01_display,
  escene_01_system,
  escene_01_terminology_version,
  escene_05,
  escene_05_precision,
  escene_05_utc_offset_minutes,
  escene_06,
  escene_06_display,
  escene_06_system,
  escene_06_terminology_version,
  escene_07,
  escene_07_display,
  escene_07_system,
  escene_07_terminology_version,
  escene_08,
  escene_08_display,
  escene_08_system,
  escene_08_terminology_version,
  escene_09,
  escene_09_display,
  escene_09_system,
  escene_09_terminology_version,
  escene_10,
  escene_12,
  escene_14,
  escene_16,
  escene_17,
  escene_17_display,
  escene_17_system,
  escene_17_terminology_version,
  escene_18,
  escene_18_display,
  escene_18_system,
  escene_18_terminology_version,
  escene_19,
  escene_21,
  escene_21_display,
  escene_21_system,
  escene_21_terminology_version,
  escene_22,
  escene_22_display,
  escene_22_system,
  escene_22_terminology_version,
  escene_23,
  escene_23_display,
  escene_23_system,
  escene_23_terminology_version,
  esituation_01,
  esituation_01_precision,
  esituation_01_utc_offset_minutes,
  esituation_02,
  esituation_02_display,
  esituation_02_system,
  esituation_02_terminology_version,
  esituation_07,
  esituation_07_display,
  esituation_07_system,
  esituation_07_terminology_version,
  esituation_08,
  esituation_08_display,
  esituation_08_system,
  esituation_08_terminology_version,
  esituation_09,
  esituation_09_display,
  esituation_09_system,
  esituation_09_terminology_version,
  esituation_11,
  esituation_11_display,
  esituation_11_system,
  esituation_11_terminology_version,
  esituation_13,
  esituation_13_display,
  esituation_13_system,
  esituation_13_terminology_version,
  esituation_14,
  esituation_14_display,
  esituation_14_system,
  esituation_14_terminology_version,
  esituation_15,
  esituation_15_display,
  esituation_15_system,
  esituation_15_terminology_version,
  esituation_16,
  esituation_16_display,
  esituation_16_system,
  esituation_16_terminology_version,
  esituation_18,
  esituation_18_precision,
  esituation_18_utc_offset_minutes,
  esituation_19,
  esituation_20,
  esituation_20_display,
  esituation_20_system,
  esituation_20_terminology_version,
  etimes_01,
  etimes_01_precision,
  etimes_01_utc_offset_minutes,
  etimes_02,
  etimes_02_precision,
  etimes_02_utc_offset_minutes,
  etimes_03,
  etimes_03_precision,
  etimes_03_utc_offset_minutes,
  etimes_04,
  etimes_04_precision,
  etimes_04_utc_offset_minutes,
  etimes_05,
  etimes_05_precision,
  etimes_05_utc_offset_minutes,
  etimes_06,
  etimes_06_precision,
  etimes_06_utc_offset_minutes,
  etimes_07,
  etimes_07_precision,
  etimes_07_utc_offset_minutes,
  etimes_08,
  etimes_08_precision,
  etimes_08_utc_offset_minutes,
  etimes_09,
  etimes_09_precision,
  etimes_09_utc_offset_minutes,
  etimes_10,
  etimes_10_precision,
  etimes_10_utc_offset_minutes,
  etimes_11,
  etimes_11_precision,
  etimes_11_utc_offset_minutes,
  etimes_12,
  etimes_12_precision,
  etimes_12_utc_offset_minutes,
  etimes_13,
  etimes_13_precision,
  etimes_13_utc_offset_minutes,
  etimes_14,
  etimes_14_precision,
  etimes_14_utc_offset_minutes,
  etimes_15,
  etimes_15_precision,
  etimes_15_utc_offset_minutes,
  etimes_16,
  etimes_16_precision,
  etimes_16_utc_offset_minutes,
  etimes_17,
  etimes_17_precision,
  etimes_17_utc_offset_minutes
  -- END GENERATED PSEUDONYMOUS EPCR VIEW COLUMNS
from analytics_private.epcr;

create view analytics.epcr_identified
with (security_barrier = true)
as select * from analytics_private.epcr;

create view analytics.epcr_repeatable_element
with (security_barrier = true)
as select * from analytics_private.epcr_repeatable_element where not is_identifying;

create view analytics.epcr_repeatable_element_identified
with (security_barrier = true)
as select * from analytics_private.epcr_repeatable_element;

create view analytics.element_dictionary
as
select
  r.standard,
  r.version as catalog_version,
  e.element_id,
  e.section,
  e.name,
  e.description,
  e.usage,
  e.national,
  e.state,
  e.base_datatype,
  e.group_path,
  m.analytical_location,
  m.sql_column,
  m.sql_type,
  m.identifying
from catalog.element_definition e
join catalog.release r on r.id = e.release_id
join catalog.analytics_element_mapping m on m.release_id = e.release_id and m.element_id = e.element_id;

create view analytics.agency
as
select
  id as agency_demographic_version_id,
  organization_id,
  version,
  dagency_01,
  dagency_02,
  dagency_04,
  dagency_04_display,
  dagency_04_system,
  dagency_04_terminology_version,
  effective_from
from app_identity.agency_demographic_version;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'open_triage_analyst') then
    create role open_triage_analyst nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'open_triage_identified_analyst') then
    create role open_triage_identified_analyst nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'open_triage_projector') then
    create role open_triage_projector nologin;
  end if;
end;
$$;

revoke all on all tables in schema analytics_private from public;
revoke all on all tables in schema analytics from public;
grant usage on schema analytics to open_triage_analyst, open_triage_identified_analyst;
grant select on analytics.epcr, analytics.epcr_repeatable_element, analytics.element_dictionary, analytics.agency to open_triage_analyst;
grant select on analytics.epcr, analytics.epcr_repeatable_element, analytics.element_dictionary, analytics.agency, analytics.epcr_identified, analytics.epcr_repeatable_element_identified to open_triage_identified_analyst;
grant usage on schema analytics_private, integration to open_triage_projector;
grant select, insert, update, delete on all tables in schema analytics_private to open_triage_projector;
grant select, update on integration.outbox_event to open_triage_projector;
grant select, insert, update on integration.projection_backfill_job to open_triage_projector;
grant usage on schema clinical, forms, catalog, app_identity to open_triage_projector;
grant select on all tables in schema clinical, forms, catalog, app_identity to open_triage_projector;
grant execute on function analytics_private.ensure_partitions(date, date) to open_triage_projector;

comment on schema analytics is 'Stable, read-only analyst interfaces. Base projections are private.';
comment on view analytics.epcr is 'One effective signed ePCR row; direct identifiers and narrative are excluded.';
comment on view analytics.epcr_repeatable_element is 'One effective signed repeatable element occurrence row; identifying elements are excluded.';
comment on view analytics.epcr_identified is 'Privileged one-row-per-ePCR view including identifying values and narrative.';
comment on table integration.outbox_event is 'Transactional source for the at-most-five-minute analytical projection.';
