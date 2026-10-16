-- Optional provider profile evidence; never a password credential or identity key.
alter table app_identity.regional_identity_request add column username_hint text
  check (username_hint is null or (char_length(username_hint) between 1 and 256
    and username_hint !~ '[[:cntrl:]]'));
grant insert(username_hint), update(username_hint) on app_identity.regional_identity_request to open_triage_api_runtime;

create or replace function app_identity.validate_regional_identity_request() returns trigger
language plpgsql set search_path = pg_catalog, app_identity as $$
begin
  if tg_op = 'UPDATE' and (new.id,new.group_id,new.provider_id,new.first_revision,new.organization_id,
      new.issuer,new.subject,new.created_at)
    is distinct from (old.id,old.group_id,old.provider_id,old.first_revision,old.organization_id,
      old.issuer,old.subject,old.created_at) then
    raise exception 'Regional identity keys and display evidence are immutable' using errcode='23514';
  end if;
  -- Backfill absent profile hints from a later validated login. Previously
  -- captured evidence and identity keys remain immutable.
  if tg_op = 'UPDATE' and (
      (old.display_name is not null and new.display_name is distinct from old.display_name)
      or (old.email is not null and new.email is distinct from old.email)
      or (old.username_hint is not null and new.username_hint is distinct from old.username_hint)) then
    raise exception 'Recorded regional identity display evidence is immutable' using errcode='23514';
  end if;
  if tg_op = 'UPDATE' and old.linked_user_id is not null and
    (new.linked_user_id,new.linked_by,new.linked_at) is distinct from
    (old.linked_user_id,old.linked_by,old.linked_at) then
    -- Unlinking is a contained denial, never a direct reassignment. Reapproval
    -- is a separate reviewed operation. Old sessions cannot revive after relink.
    if new.linked_user_id is not null or new.linked_by is not null or new.linked_at is not null
      or new.denied_at is null or new.denied_by is null
      or new.review_revision <> old.review_revision + 1
      or exists(select 1 from app_identity.app_session where user_id=old.linked_user_id and revoked_at is null) then
      raise exception 'Regional identity is already linked' using errcode='23514';
    end if;
  end if;
  if not exists(select 1 from app_identity.oidc_provider_version v where v.group_id=new.group_id
      and v.revision=new.first_revision and v.provider_id=new.provider_id
      and v.configuration->>'issuer'=new.issuer collate "C")
    or app_identity.organization_group(new.organization_id) is distinct from new.group_id then
    raise exception 'Regional identity integration scope is invalid' using errcode='23514';
  end if;
  if new.linked_user_id is not null then
    -- Serialize with account disablement, group moves and protected owner changes.
    perform 1 from app_identity.app_user where id=new.linked_user_id for update;
    if not exists(select 1 from app_identity.app_user u where u.id=new.linked_user_id and u.active
        and u.account_scope='agency' and app_identity.organization_group(u.organization_id)=new.group_id)
      or exists(select 1 from app_identity.installation_owner where user_id=new.linked_user_id)
      or exists(select 1 from app_identity.installation_superadmin where user_id=new.linked_user_id) then
      raise exception 'Regional identity target is not an ordinary active group user' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function app_identity.validate_regional_identity_request() from public;
