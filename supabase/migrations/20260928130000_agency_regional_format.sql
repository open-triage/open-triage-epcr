-- Optional region keeps existing installations' presentation unchanged.
alter table app_identity.agency_settings
  add column regional_format text
  constraint agency_settings_regional_format_supported
  check (regional_format is null or regional_format in ('en-US', 'sv-SE'));

alter table app_identity.agency_settings_change_event
  add column old_regional_format text,
  add column new_regional_format text,
  add constraint agency_settings_change_event_old_regional_format_supported
    check (old_regional_format is null or old_regional_format in ('en-US', 'sv-SE')),
  add constraint agency_settings_change_event_new_regional_format_supported
    check (new_regional_format is null or new_regional_format in ('en-US', 'sv-SE'));
