-- A report-level custom field is an occurrence without analytical group metadata.
-- Existing clinical root groups and grouped/repeated occurrences are unchanged.
alter table analytics_private.epcr_repeatable_element
  alter column group_id drop not null,
  alter column group_instance_id drop not null,
  alter column group_ordinal drop not null;

alter table analytics_private.epcr_repeatable_element
  add column is_custom boolean not null default false,
  add column custom_definition_id uuid,
  add column custom_definition jsonb,
  add constraint custom_projection_context check (
    (is_custom and custom_definition_id = element_identity_id and custom_definition is not null)
    or (not is_custom and custom_definition_id is null and custom_definition is null)
  ),
  add constraint report_level_custom_occurrence check (
    group_instance_id is not null or
    (is_custom and group_id is null and group_ordinal is null
      and cardinality(group_path) = 0 and cardinality(instance_path) = 0)
  );

create index analytics_custom_report_idx on analytics_private.epcr_repeatable_element
  (organization_id, custom_definition_id, reporting_date, report_id)
  where is_custom;

-- The API receives only the columns needed for scoped, single-field Review BI.
-- It filters organization, owner, real/synthetic, and identifying access itself.
create view analytics.review_custom_field_source with (security_barrier = true) as
select c.report_id, c.organization_id, c.reporting_date,
  c.element_occurrence_id, c.custom_definition_id,
  c.custom_definition, c.value_kind, c.value_text, c.value_integer,
  c.value_numeric, c.value_boolean, c.value_date, c.value_datetime, c.code,
  c.absence_kind, c.not_value_code, c.pertinent_negative_code,
  c.is_identifying
from analytics_private.epcr_repeatable_element c
where c.is_custom and c.group_instance_id is null;

create view analytics.review_custom_dictionary with (security_barrier = true) as
select organization_id, custom_definition_id,
  max(custom_definition->>'title') as title,
  min(custom_definition->>'datatype') as datatype,
  min(custom_definition->>'recurrence') as recurrence,
  bool_or(is_identifying) as identifying,
  count(distinct custom_definition - 'title' - 'localization' - 'retired' - 'usage') as semantic_count,
  count(distinct custom_definition->>'datatype') as datatype_count,
  count(distinct custom_definition->>'recurrence') as recurrence_count,
  count(distinct is_identifying) as privacy_count
from analytics_private.epcr_repeatable_element
where is_custom and group_instance_id is null
group by organization_id, custom_definition_id;

revoke all on analytics.review_custom_field_source, analytics.review_custom_dictionary
  from public, anon, authenticated, open_triage_analyst, open_triage_identified_analyst;
grant select on analytics.review_custom_field_source, analytics.review_custom_dictionary
  to open_triage_api_runtime;
grant select, insert, update, delete on analytics_private.epcr_repeatable_element
  to open_triage_projector;
comment on view analytics.review_custom_field_source is
  'API-only report-level custom source; the service enforces organization and identifying scope.';
