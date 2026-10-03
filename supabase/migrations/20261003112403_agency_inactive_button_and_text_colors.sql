-- Keep clinical inactive button backgrounds and text in revisioned agency appearance.
alter table app_identity.agency_settings
  add column inactive_button_color text not null default '#ffffff'
    check (inactive_button_color ~ '^#[0-9a-f]{6}$'),
  add column text_color text not null default '#1a1c1a'
    check (text_color ~ '^#[0-9a-f]{6}$');

-- Preserve earlier audit events without inventing historical color values.
alter table app_identity.agency_settings_change_event
  add column old_inactive_button_color text
    check (old_inactive_button_color is null or old_inactive_button_color ~ '^#[0-9a-f]{6}$'),
  add column new_inactive_button_color text
    check (new_inactive_button_color is null or new_inactive_button_color ~ '^#[0-9a-f]{6}$'),
  add column old_text_color text
    check (old_text_color is null or old_text_color ~ '^#[0-9a-f]{6}$'),
  add column new_text_color text
    check (new_text_color is null or new_text_color ~ '^#[0-9a-f]{6}$');
