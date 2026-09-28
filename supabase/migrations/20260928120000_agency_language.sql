-- Language is an agency setting, shared by all workspaces. Existing agencies keep English.
alter table app_identity.agency_settings
  add column language text not null default 'en'
  constraint agency_settings_language_supported check (language in ('en', 'sv'));

alter table app_identity.agency_settings_change_event
  add column old_language text,
  add column new_language text,
  add constraint agency_settings_change_event_old_language_supported
    check (old_language is null or old_language in ('en', 'sv')),
  add constraint agency_settings_change_event_new_language_supported
    check (new_language is null or new_language in ('en', 'sv'));
