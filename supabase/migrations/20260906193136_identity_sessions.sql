-- Provider-neutral local credentials. Passwords and bearer material are never stored;
-- only versioned password verifiers and SHA-256 token digests are durable.
create table app_identity.local_credential (
  user_id uuid primary key references app_identity.app_user(id),
  username text not null unique check (
    username = lower(btrim(username)) and
    username ~ '^[a-z0-9][a-z0-9._-]{2,127}$'
  ),
  password_verifier text not null check (password_verifier ~ '^scrypt[$]'),
  must_change_password boolean not null default true,
  credential_version bigint not null default 1 check (credential_version > 0),
  password_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index local_credential_username_user_idx
  on app_identity.local_credential (username, user_id);

create table app_identity.app_session (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_identity.app_user(id),
  token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
  csrf_sha256 text not null check (csrf_sha256 ~ '^[a-f0-9]{64}$'),
  credential_version bigint not null check (credential_version > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text,
  check (expires_at > created_at),
  check ((revoked_at is null) = (revocation_reason is null))
);

create index app_session_active_user_idx
  on app_identity.app_session (user_id, expires_at)
  where revoked_at is null;

create table app_identity.authentication_event (
  id bigint generated always as identity primary key,
  organization_id uuid references app_identity.organization(id),
  actor_id uuid references app_identity.app_user(id),
  action text not null check (action in (
    'account.provision', 'account.reset_password', 'authentication.sign_in',
    'authentication.password_change', 'authentication.sign_out'
  )),
  result text not null check (result in ('succeeded', 'failed')),
  target_user_id uuid references app_identity.app_user(id),
  session_id uuid,
  occurred_at timestamptz not null default now(),
  details jsonb not null default '{}'::jsonb,
  check (not (details ?| array['password', 'password_verifier', 'token', 'csrf']))
);

create index authentication_event_organization_time_idx
  on app_identity.authentication_event (organization_id, occurred_at desc);
create index authentication_event_actor_time_idx
  on app_identity.authentication_event (actor_id, occurred_at desc);

create trigger authentication_event_append_only
before update or delete on app_identity.authentication_event
for each row execute function public.prevent_update_or_delete();

revoke all on app_identity.local_credential, app_identity.app_session,
  app_identity.authentication_event from public;
