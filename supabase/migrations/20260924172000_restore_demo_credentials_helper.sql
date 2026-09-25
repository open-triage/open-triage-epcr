-- Restore the documented demonstration credentials as the default sign-in
-- helper for newly created organizations. Existing agency-customized text is
-- left unchanged; the local demonstration organization is updated through the
-- ordinary revisioned settings workflow.
alter table app_identity.agency_settings
  alter column helper_text set default
    'Demo credentials: username **demo**, password **opentriagedemo**';
