-- A single sequence keeps PCR identifiers unique across agencies and reports,
-- including after a synthetic draft is deleted. Gaps can occur on rollback.
create sequence clinical.pcr_number_sequence as bigint start with 1;

revoke all on sequence clinical.pcr_number_sequence from public;
grant usage on sequence clinical.pcr_number_sequence to open_triage_api_runtime;

-- Earlier New patient drafts were created without a PCR number. Supply one
-- before making the field read only so those drafts remain signable.
do $$
declare
  draft_report record;
  group_name text;
  parent_id uuid;
  group_id uuid;
  record_mapping record;
  serial_number text;
begin
  for draft_report in
    select report.id, report.catalog_release_id, report.documenting_user_id
    from clinical.report report
    where report.status = 'draft'
      and not exists (
        select 1 from clinical.element_occurrence occurrence
        where occurrence.report_id = report.id
          and occurrence.element_id = 'eRecord.01'
          and occurrence.tombstoned_at is null
      )
    order by report.id
  loop
    parent_id := null;
    foreach group_name in array array['EMSDataSet', 'HeaderGroup', 'PatientCareReportGroup', 'eRecordSection'] loop
      select instance.id into group_id
      from clinical.group_instance instance
      where instance.report_id = draft_report.id
        and instance.group_id = group_name
        and instance.parent_group_instance_id is not distinct from parent_id
        and instance.tombstoned_at is null
      order by instance.ordinal, instance.id
      limit 1;
      if group_id is null then
        insert into clinical.group_instance
          (id, report_id, catalog_release_id, parent_group_instance_id, group_id, ordinal, created_by)
        values (gen_random_uuid(), draft_report.id, draft_report.catalog_release_id,
          parent_id, group_name, 0, draft_report.documenting_user_id)
        returning id into group_id;
      end if;
      parent_id := group_id;
    end loop;

    select mapping.element_identity_id,
           mapping.analytical_location = 'repeatable' as analytical_repeatable,
           mapping.identifying
      into strict record_mapping
    from catalog.analytics_element_mapping mapping
    where mapping.release_id = draft_report.catalog_release_id
      and mapping.element_id = 'eRecord.01';
    serial_number := nextval('clinical.pcr_number_sequence')::text;
    insert into clinical.element_occurrence
      (id, report_id, catalog_release_id, group_instance_id, element_identity_id,
       element_id, ordinal, analytical_repeatable, identifying, value_kind,
       value_text, provenance_kind, author_id)
    values (gen_random_uuid(), draft_report.id, draft_report.catalog_release_id,
      parent_id, record_mapping.element_identity_id, 'eRecord.01', 0,
      record_mapping.analytical_repeatable, record_mapping.identifying, 'text',
      'PCR-' || repeat('0', greatest(0, 9 - length(serial_number))) || serial_number,
      'dispatch', draft_report.documenting_user_id);
  end loop;
end;
$$;
