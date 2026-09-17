-- Portable NOLOGIN roles define the maximum database contract for each
-- long-lived workload. Installation-specific LOGIN roles and passwords are
-- provisioned and rotated outside migrations.
do $$
declare
  role_name text;
begin
  foreach role_name in array array[
    'open_triage_api_runtime',
    'open_triage_migration_executor',
    'open_triage_analytics_projector',
    'open_triage_analytics_health',
    'open_triage_retention',
    'open_triage_operational_audit_writer'
  ] loop
    if not exists (select 1 from pg_roles where rolname = role_name) then
      execute format(
        'create role %I nologin nosuperuser nocreatedb nocreaterole inherit nobypassrls',
        role_name
      );
    end if;
  end loop;
end;
$$;

-- Do not let a runtime role use PostgreSQL's default database/schema CREATE
-- grants to bypass the explicit object contracts below.
do $$
begin
  execute format('revoke create on database %I from public', current_database());
end;
$$;
revoke create on schema public from public;

grant usage on schema app_identity, catalog, forms, clinical, clinical_audit,
  integration, feedback, retention to open_triage_api_runtime;
grant select, insert, update, delete on all tables in schema app_identity,
  catalog, forms, clinical, clinical_audit, integration, feedback
  to open_triage_api_runtime;
grant usage, select on all sequences in schema app_identity, catalog, forms,
  clinical, clinical_audit, integration, feedback to open_triage_api_runtime;
grant execute on function retention.purge_expired_synthetic_records(timestamptz)
  to open_triage_api_runtime;

-- Future runtime tables created by this installation's migration owner inherit
-- the same application contract. Restricted schemas are intentionally absent.
alter default privileges in schema app_identity, catalog, forms, clinical,
  clinical_audit, integration, feedback
  grant select, insert, update, delete on tables to open_triage_api_runtime;
alter default privileges in schema app_identity, catalog, forms, clinical,
  clinical_audit, integration, feedback
  grant usage, select on sequences to open_triage_api_runtime;

-- The projector must inspect identified signed source state to build the
-- de-identified and identified analytical contracts. No other analytics
-- workload receives that source access.
revoke all on all tables in schema clinical, forms, catalog, app_identity
  from open_triage_projector;
revoke all on schema clinical, forms, catalog, app_identity
  from open_triage_projector;
grant usage on schema clinical, forms, catalog to open_triage_projector;
grant select on
  clinical.report,
  clinical.patient,
  clinical.signed_snapshot,
  clinical.element_occurrence,
  clinical.group_instance,
  clinical.amendment,
  clinical.amendment_change,
  forms.form_version,
  forms.custom_group_definition,
  catalog.release,
  catalog.element_identity,
  catalog.analytics_element_mapping,
  catalog.repeating_group_time_mapping
  to open_triage_projector;
grant open_triage_projector to open_triage_analytics_projector;

grant usage on schema operations to open_triage_analytics_health;
grant select on operations.projection_health to open_triage_analytics_health;

grant open_triage_retention_executor to open_triage_retention;
grant usage on schema retention to open_triage_retention;
grant execute on function retention.purge_expired_synthetic_records(timestamptz)
  to open_triage_retention;

grant open_triage_query_auditor to open_triage_operational_audit_writer;

-- Migration authority is deliberately not granted to any long-lived workload.
-- The installation-specific migration LOGIN is the owner used by the
-- forward-only migration job and is never mounted into another pod.
comment on role open_triage_migration_executor is
  'Marker role for the short-lived installation migration owner; never grant to a runtime login';
comment on role open_triage_api_runtime is
  'Network API runtime; application schemas only, with no analytical-private or operations access';
comment on role open_triage_analytics_projector is
  'Analytics projection worker; identified source access is limited to the documented projection contract';
comment on role open_triage_analytics_health is
  'Projection health worker; aggregate operations.projection_health only';
comment on role open_triage_retention is
  'Retention and synthetic purge executor';
comment on role open_triage_operational_audit_writer is
  'Operational query-audit metadata writer; no clinical or analytical table access';
