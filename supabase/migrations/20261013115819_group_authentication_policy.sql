-- Migration rule: adopt root values only after all existing members agree.
-- Abort with the group ID on conflict; operators explicitly align legacy values
-- following docs/runbooks/group-authentication-policy.md, then retry unchanged.
do $$
declare conflict_group uuid;
begin
  select app_identity.organization_group(agency.id) into conflict_group
  from app_identity.organization agency left join app_identity.agency_settings settings on settings.organization_id=agency.id
  group by app_identity.organization_group(agency.id)
  having count(distinct agency.shift_session_duration_hours)>1
    or count(distinct coalesce(settings.authentication_account_attempt_limit,20))>1
    or count(distinct coalesce(settings.authentication_network_attempt_limit,60))>1
  limit 1;
  if conflict_group is not null then
    raise exception 'Conflicting legacy authentication settings in group %. Resolve explicitly before migration; see group-authentication-policy runbook.', conflict_group;
  end if;
end $$;
create table app_identity.group_authentication_policy (
  group_id uuid primary key references app_identity.organization(id),
  maximum_session_hours integer not null check (maximum_session_hours between 1 and 168),
  -- NULL preserves the operator-configured installation temporary-password default.
  temporary_password_hours integer check (temporary_password_hours between 1 and 168),
  account_attempt_limit integer not null check (account_attempt_limit between 1 and 1000),
  network_attempt_limit integer not null check (network_attempt_limit between 1 and 1000),
  revision bigint not null default 1 check (revision>0)
);
insert into app_identity.group_authentication_policy
  (group_id,maximum_session_hours,account_attempt_limit,network_attempt_limit)
select agency.id,agency.shift_session_duration_hours,
  coalesce(settings.authentication_account_attempt_limit,20),coalesce(settings.authentication_network_attempt_limit,60)
from app_identity.organization agency left join app_identity.agency_settings settings on settings.organization_id=agency.id
where agency.parent_organization_id is null;
create function app_identity.seed_group_authentication_policy()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.parent_organization_id is null then
    insert into app_identity.group_authentication_policy
      (group_id,maximum_session_hours,account_attempt_limit,network_attempt_limit)
    values (new.id,new.shift_session_duration_hours,20,60);
  end if;
  return new;
end $$;
create trigger organization_seed_authentication after insert on app_identity.organization
  for each row execute function app_identity.seed_group_authentication_policy();
revoke all on app_identity.group_authentication_policy from public;
revoke all on function app_identity.seed_group_authentication_policy() from public;
grant select,insert,update on app_identity.group_authentication_policy to open_triage_api_runtime;
grant execute on function app_identity.seed_group_authentication_policy() to open_triage_api_runtime;
-- Private service-owned schema: tenant authorization is enforced by the shared
-- capability service, just as for agency_settings. No Data API grants.
alter table app_identity.authentication_event
  drop constraint authentication_event_action_check,
  add constraint authentication_event_action_check check (action in (
    'account.provision', 'account.reset_password', 'account.identity_change',
    'account.disable', 'account.reactivate', 'account.roles_change',
    'authentication.sign_in', 'authentication.password_change',
    'authentication.reauthenticate', 'authentication.sign_out',
    'authentication.session_revoke', 'offline_recovery.administrative_purge', 'authentication.policy_update'
  ));
