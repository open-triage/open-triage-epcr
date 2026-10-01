-- Tombstones preserve clinical history, but they must not reserve the position
-- of a replacement group or element occurrence in an unsigned report.
alter table clinical.group_instance
  drop constraint group_instance_report_id_parent_group_instance_id_group_id__key;

create unique index group_instance_active_position_key
  on clinical.group_instance (report_id, parent_group_instance_id, group_id, ordinal)
  nulls not distinct
  where tombstoned_at is null;

alter table clinical.element_occurrence
  drop constraint element_occurrence_report_id_group_instance_id_element_iden_key;

create unique index element_occurrence_active_position_key
  on clinical.element_occurrence (report_id, group_instance_id, element_identity_id, ordinal)
  nulls not distinct
  where tombstoned_at is null;
