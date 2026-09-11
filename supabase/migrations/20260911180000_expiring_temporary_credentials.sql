-- Temporary local credentials are valid only during an explicit, bounded
-- provisioning window. Permanent credentials carry no temporary expiry.
alter table app_identity.local_credential
  add column temporary_password_expires_at timestamptz;

update app_identity.local_credential
set temporary_password_expires_at = updated_at + interval '72 hours'
where must_change_password;

alter table app_identity.local_credential
  add constraint local_credential_temporary_expiry_check check (
    (must_change_password and temporary_password_expires_at is not null
      and temporary_password_expires_at > updated_at)
    or (not must_change_password and temporary_password_expires_at is null)
  );

alter table app_identity.authentication_event
  add column note text check (
    note is null or (
      char_length(note) <= 1000
      and note !~ '[[:cntrl:]]'
    )
  );

-- The expiry timestamp is useful for operational cleanup and boundary tests;
-- the partial index excludes permanent credentials.
create index local_credential_temporary_expiry_idx
  on app_identity.local_credential (temporary_password_expires_at, user_id)
  where must_change_password;
