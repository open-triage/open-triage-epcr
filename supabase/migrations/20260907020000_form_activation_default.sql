-- One explicitly activated Stationary form version per agency. Publication alone
-- never changes this pointer; historical reports retain their own pinned IDs.

create table forms.agency_stationary_default (
  organization_id uuid primary key references app_identity.organization(id),
  form_version_id uuid not null unique references forms.form_version(id),
  activated_by uuid not null references app_identity.app_user(id),
  activated_at timestamptz not null default now()
);

create function forms.validate_agency_stationary_default()
returns trigger
language plpgsql
as $$
declare
  version_organization_id uuid;
  version_status text;
  actor_organization_id uuid;
begin
  select f.organization_id, fv.status
    into version_organization_id, version_status
  from forms.form_version fv
  join forms.form f on f.id = fv.form_id
  where fv.id = new.form_version_id;

  select organization_id into actor_organization_id
  from app_identity.app_user where id = new.activated_by;

  if version_organization_id is distinct from new.organization_id or version_status <> 'published' then
    raise exception 'agency Stationary default must be a published form version from the same organization';
  end if;
  if actor_organization_id is distinct from new.organization_id then
    raise exception 'activation actor must be active in the same organization';
  end if;
  return new;
end;
$$;

create trigger agency_stationary_default_validate
before insert or update on forms.agency_stationary_default
for each row execute function forms.validate_agency_stationary_default();

create table app_identity.configuration_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null references app_identity.app_user(id),
  action text not null check (action in ('form.publish', 'form.activate')),
  result text not null check (result in ('succeeded', 'failed')),
  form_version_id uuid not null references forms.form_version(id),
  catalog_release_id uuid not null references catalog.release(id),
  previous_form_version_id uuid references forms.form_version(id),
  previous_catalog_release_id uuid references catalog.release(id),
  change_note text not null check (length(btrim(change_note)) > 0),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (not (details ?| array['password', 'password_verifier', 'token', 'csrf', 'clinical_content']))
);

create index configuration_event_organization_time_idx
  on app_identity.configuration_event (organization_id, occurred_at desc);

create trigger configuration_event_append_only
before update or delete on app_identity.configuration_event
for each row execute function public.prevent_update_or_delete();

-- Preserve the installation's pre-migration effective default. Future changes
-- occur only through explicit activation.
insert into forms.agency_stationary_default (organization_id, form_version_id, activated_by)
select organization_id, form_version_id, actor_id
from (
  select f.organization_id, fv.id as form_version_id, fv.published_by as actor_id,
         row_number() over (partition by f.organization_id order by fv.published_at desc, fv.version desc) as ordinal
  from forms.form f
  join forms.form_version fv on fv.form_id = f.id and fv.status = 'published'
  where exists (
    select 1 from app_identity.operational_unit ou
    where ou.organization_id = f.organization_id and ou.default_form_id = f.id and ou.active
  )
) candidate
where ordinal = 1;

revoke all on forms.agency_stationary_default, app_identity.configuration_event from public;
