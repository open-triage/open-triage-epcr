-- High-impact protected-role changes rely on a short-lived assurance recorded
-- only against the server-side session. No elevation bearer value is issued.
alter table app_identity.app_session
  add column reauthenticated_at timestamptz,
  add constraint app_session_reauthentication_after_creation check (
    reauthenticated_at is null or reauthenticated_at >= created_at
  );

create index app_session_recent_reauthentication_idx
  on app_identity.app_session (token_sha256, reauthenticated_at)
  where revoked_at is null and reauthenticated_at is not null;

alter table app_identity.authentication_event
  drop constraint authentication_event_action_check,
  add constraint authentication_event_action_check check (action in (
    'account.provision', 'account.reset_password', 'account.identity_change',
    'account.disable', 'account.reactivate', 'account.roles_change',
    'authentication.sign_in', 'authentication.password_change',
    'authentication.reauthenticate', 'authentication.sign_out'
  ));
