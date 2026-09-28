-- UI languages are supplied by release-bundled message dictionaries. The API checks
-- membership in that bundle; Postgres enforces the language-code shape and retains
-- existing settings and audit history when a dictionary is removed in a later release.
alter table app_identity.agency_settings
  drop constraint agency_settings_language_supported,
  add constraint agency_settings_language_supported
    check (char_length(language) <= 35 and language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

alter table app_identity.agency_settings_change_event
  drop constraint agency_settings_change_event_old_language_supported,
  add constraint agency_settings_change_event_old_language_supported
    check (old_language is null or
      (char_length(old_language) <= 35 and old_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$')),
  drop constraint agency_settings_change_event_new_language_supported,
  add constraint agency_settings_change_event_new_language_supported
    check (new_language is null or
      (char_length(new_language) <= 35 and new_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'));
