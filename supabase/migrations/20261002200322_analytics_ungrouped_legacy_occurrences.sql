-- Retain legacy repeated values without inventing a clinical group or correlation.
-- Grouped/time analyses cannot correlate these rows; report-volume remains complete.
alter table analytics_private.epcr_repeatable_element
  drop constraint report_level_custom_occurrence,
  add constraint report_level_custom_occurrence check (
    group_instance_id is not null or
    (is_custom and group_id is null and group_ordinal is null
      and cardinality(group_path)=0 and cardinality(instance_path)=0) or
    (not is_custom and group_id is not null and group_ordinal is null
      and cardinality(group_path)>0 and cardinality(instance_path)=0
      and coalesce(quality_flags @> array['missing-group-instance']::text[],false))
  );
