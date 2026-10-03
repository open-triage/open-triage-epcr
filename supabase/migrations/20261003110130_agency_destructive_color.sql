-- Keep destructive button presentation in the revisioned agency settings.
alter table app_identity.agency_settings
  add column destructive_color text not null default '#b42318'
    check (destructive_color ~ '^#[0-9a-f]{6}$');

-- Existing audit events keep null for the newly introduced setting.
alter table app_identity.agency_settings_change_event
  add column old_destructive_color text
    check (old_destructive_color is null or old_destructive_color ~ '^#[0-9a-f]{6}$'),
  add column new_destructive_color text
    check (new_destructive_color is null or new_destructive_color ~ '^#[0-9a-f]{6}$');
