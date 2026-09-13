-- Store only privacy-bounded session metadata. Full user-agent strings, source
-- addresses, and geolocation are intentionally absent from the identity model.
alter table app_identity.app_session
  add column last_activity_at timestamptz,
  add column device_label text not null default 'Other browser on Other OS'
    check (char_length(device_label) between 1 and 100 and device_label !~ '[[:cntrl:]]');

update app_identity.app_session
set last_activity_at = created_at
where last_activity_at is null;

alter table app_identity.app_session
  alter column last_activity_at set default now(),
  alter column last_activity_at set not null,
  add constraint app_session_activity_after_creation_check
    check (last_activity_at >= created_at);

create index app_session_active_user_activity_idx
  on app_identity.app_session (user_id, last_activity_at desc, id)
  where revoked_at is null;

alter table app_identity.authentication_event
  drop constraint authentication_event_action_check,
  add constraint authentication_event_action_check check (action in (
    'account.provision', 'account.reset_password', 'account.identity_change',
    'account.disable', 'account.reactivate', 'account.roles_change',
    'authentication.sign_in', 'authentication.password_change', 'authentication.reauthenticate',
    'authentication.sign_out', 'authentication.session_revoke'
  ));
