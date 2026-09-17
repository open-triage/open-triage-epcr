-- Cross-replica authentication throttling. Keys are application-generated HMACs;
-- usernames and network addresses are intentionally not stored here or in audit.
create table app_identity.authentication_throttle (
  scope text not null check (scope in ('account', 'network', 'installation')),
  key_digest text not null check (key_digest ~ '^[a-f0-9]{64}$'),
  window_seconds integer not null check (window_seconds between 1 and 86400),
  max_attempts integer not null check (max_attempts > 0),
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  blocked_until timestamptz,
  last_attempt_at timestamptz not null,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  expires_at timestamptz not null,
  primary key (scope, key_digest),
  check (expires_at >= last_attempt_at)
);

create index authentication_throttle_expiry_idx
  on app_identity.authentication_throttle (expires_at);
create index authentication_throttle_blocked_idx
  on app_identity.authentication_throttle (blocked_until desc)
  where blocked_until is not null;

revoke all on app_identity.authentication_throttle from public;

comment on table app_identity.authentication_throttle is
  'Short-lived HMAC-keyed counters for replica-safe authentication throttling; never contains raw usernames or network addresses.';
