-- Existing agencies keep the current policy. Older clients may omit these
-- fields; the API preserves the stored values on unrelated settings updates.
alter table app_identity.agency_settings
  add column authentication_account_attempt_limit integer not null default 20
    check (authentication_account_attempt_limit between 1 and 1000),
  add column authentication_network_attempt_limit integer not null default 60
    check (authentication_network_attempt_limit between 1 and 1000);

-- Historical events predate this policy and intentionally retain null values.
alter table app_identity.agency_settings_change_event
  add column old_authentication_account_attempt_limit integer
    check (old_authentication_account_attempt_limit between 1 and 1000),
  add column new_authentication_account_attempt_limit integer
    check (new_authentication_account_attempt_limit between 1 and 1000),
  add column old_authentication_network_attempt_limit integer
    check (old_authentication_network_attempt_limit between 1 and 1000),
  add column new_authentication_network_attempt_limit integer
    check (new_authentication_network_attempt_limit between 1 and 1000);

comment on column app_identity.agency_settings.authentication_account_attempt_limit is
  'Maximum password-verification attempts per account per 15-minute window, including successful checks.';
comment on column app_identity.agency_settings.authentication_network_attempt_limit is
  'Maximum password-verification attempts per agency and network source per 5-minute window, including successful checks.';
