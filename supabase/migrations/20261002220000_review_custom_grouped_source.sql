-- Include grouped custom occurrences in the same API-only source as standalone
-- custom values. Clinical ancestry is copied, never reconstructed from labels.
create or replace view analytics.review_custom_field_source with (security_barrier = true) as
select c.report_id, c.organization_id, c.reporting_date,
  c.element_occurrence_id, c.custom_definition_id,
  c.custom_definition, c.value_kind, c.value_text, c.value_integer,
  c.value_numeric, c.value_boolean, c.value_date, c.value_datetime, c.code,
  c.absence_kind, c.not_value_code, c.pertinent_negative_code,
  c.is_identifying,
  c.element_identity_id, c.element_id, c.catalog_release_id,
  c.effective_amendment_sequence, c.group_id, c.group_instance_id,
  c.parent_group_instance_id, c.group_path, c.instance_path,
  c.group_ordinal, c.element_ordinal, c.correlation_id, c.group_correlation_id,
  c.clinical_time, c.documented_time, c.source_unit_code,
  c.normalized_unit_code, c.normalized_numeric,
  c.normalization_rule_id, c.quality_flags
from analytics_private.epcr_repeatable_element c
where c.is_custom;

create or replace view analytics.review_custom_dictionary with (security_barrier = true) as
select organization_id, custom_definition_id,
  max(custom_definition->>'title') as title,
  min(custom_definition->>'datatype') as datatype,
  min(custom_definition->>'recurrence') as recurrence,
  bool_or(is_identifying) as identifying,
  count(distinct custom_definition - 'title' - 'localization' - 'retired' - 'usage') as semantic_count,
  count(distinct custom_definition->>'datatype') as datatype_count,
  count(distinct custom_definition->>'recurrence') as recurrence_count,
  count(distinct is_identifying) as privacy_count,
  bool_or(group_instance_id is not null) as grouped
from analytics_private.epcr_repeatable_element
where is_custom
group by organization_id, custom_definition_id;

comment on view analytics.review_custom_field_source is
  'API-only effective custom occurrences with pinned clinical ancestry and amendment sequence.';
comment on view analytics.review_custom_dictionary is
  'API-only historical custom field metadata; requests enforce organization and identifying scope.';
