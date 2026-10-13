-- Reassignment is another immutable scoped registration; the event permanently
-- retires its predecessor's credential, including future revoked-cookie recovery.
alter table app_identity.installation_event drop constraint installation_event_event_type_check;
alter table app_identity.installation_event add constraint installation_event_event_type_check
 check(event_type in ('enrollment-issued','installation-enrolled','installation-revoked','installation-reassigned'));

-- Runtime writes may retire a registration once, never rewrite scoped history
-- or restore a binding by clearing its revocation timestamp.
create function app_identity.guard_installation_registration_history()
returns trigger language plpgsql set search_path = '' as $$
begin
 if (to_jsonb(new)-'revoked_at') is distinct from (to_jsonb(old)-'revoked_at')
   or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
   raise exception 'Installation registration history is immutable' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function app_identity.guard_installation_registration_history() from public,open_triage_api_runtime;
grant execute on function app_identity.guard_installation_registration_history() to open_triage_api_runtime;
create trigger installation_registration_history_immutable before update
 on app_identity.installation_registration for each row execute function app_identity.guard_installation_registration_history();
