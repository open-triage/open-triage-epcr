-- A null setting preserves each clinician's device clock for existing installations.
alter table app_identity.agency_settings add column time_zone text;
alter table app_identity.agency_settings_change_event
  add column old_time_zone text,
  add column new_time_zone text;
