-- Durable user identities are revisioned for optimistic concurrency. Usernames
-- are permanently reserved to one identity even after that identity is renamed.
alter table app_identity.app_user
  add column revision bigint not null default 1 check (revision > 0);

create table app_identity.username_reservation (
  username text primary key check (
    username = lower(btrim(username)) and
    username ~ '^[a-z0-9][a-z0-9._-]{2,127}$'
  ),
  user_id uuid not null references app_identity.app_user(id),
  reserved_at timestamptz not null default now(),
  unique (user_id, username)
);

insert into app_identity.username_reservation (username, user_id, reserved_at)
select username, user_id, created_at from app_identity.local_credential;

alter table app_identity.local_credential
  add constraint local_credential_reserved_username_fkey
  foreign key (user_id, username)
  references app_identity.username_reservation(user_id, username)
  deferrable initially deferred;

create function app_identity.reserve_local_username()
returns trigger language plpgsql as $$
begin
  insert into app_identity.username_reservation (username, user_id)
  values (new.username, new.user_id)
  on conflict (username) do nothing;
  if not exists (
    select 1 from app_identity.username_reservation reservation
    where reservation.username = new.username and reservation.user_id = new.user_id
  ) then
    raise unique_violation using message = 'username is permanently reserved';
  end if;
  return new;
end;
$$;

create trigger local_credential_username_reserved
before insert or update of username, user_id on app_identity.local_credential
for each row execute function app_identity.reserve_local_username();

create trigger username_reservation_append_only
before update or delete on app_identity.username_reservation
for each row execute function public.prevent_update_or_delete();

alter table app_identity.authentication_event
  drop constraint authentication_event_action_check,
  add constraint authentication_event_action_check check (action in (
    'account.provision', 'account.reset_password', 'account.identity_change',
    'account.disable', 'account.reactivate', 'account.roles_change',
    'authentication.sign_in', 'authentication.password_change', 'authentication.sign_out'
  ));

revoke all on app_identity.username_reservation from public;
revoke execute on function app_identity.reserve_local_username() from public;
