-- Keep the immutable binding, even if its registration is later revoked/reassigned.
alter table app_identity.app_session add column installation_registration_id uuid
 references app_identity.installation_registration(id);
create index app_session_installation_registration_idx on app_identity.app_session(installation_registration_id);
alter table app_identity.installation_event drop constraint installation_event_event_type_check;
alter table app_identity.installation_event add constraint installation_event_event_type_check
 check(event_type in ('enrollment-issued','installation-enrolled','installation-revoked'));
alter table app_identity.installation_event add column details jsonb not null default '{}'::jsonb;

-- Every session issuer (including future authentication modes) shares the same
-- serialized guard. Bindings on existing sessions are immutable once assigned.
create function app_identity.guard_session_installation_registration()
returns trigger language plpgsql set search_path = '' as $$
begin
 if tg_op='UPDATE' and old.installation_registration_id is not null
   and new.installation_registration_id is distinct from old.installation_registration_id then
   raise exception 'Session installation association is immutable' using errcode='23514';
 end if;
 if new.installation_registration_id is not null then
   perform i.id from app_identity.installation_registration i
     join app_identity.operational_unit u on u.id=i.unit_id and u.organization_id=i.organization_id
     join app_identity.organization a on a.id=i.organization_id
     join app_identity.organization g on g.id=coalesce(a.parent_organization_id,a.id)
     where i.id=new.installation_registration_id and i.revoked_at is null and u.active and a.active and g.active
     for share of i,u,a,g;
   if not found then raise exception 'Installation registration is unavailable' using errcode='23514'; end if;
 end if;
 return new;
end;
$$;
revoke all on function app_identity.guard_session_installation_registration() from public,open_triage_api_runtime;
grant execute on function app_identity.guard_session_installation_registration() to open_triage_api_runtime;
create trigger app_session_installation_registration_valid before insert or update of installation_registration_id
 on app_identity.app_session for each row execute function app_identity.guard_session_installation_registration();
