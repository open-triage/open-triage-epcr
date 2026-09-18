-- One authoritative, immutable-artifact configuration selection per organization.
-- Legacy Form and Validation pointers remain synchronized for existing read paths,
-- while report creation reads this complete bundle exclusively.

create table validation.platform_element_source (
  catalog_release_id uuid not null,
  element_id text not null,
  source_key text not null check (char_length(btrim(source_key)) between 1 and 100),
  primary key (catalog_release_id, element_id, source_key),
  foreign key (catalog_release_id, element_id)
    references catalog.element_definition(release_id, element_id)
);

create index validation_platform_element_lookup_idx
  on validation.platform_element_source (catalog_release_id, element_id);

-- These identities are created or required by the dispatch/platform workflow and
-- therefore need not be visible as clinician-editable Form fields.
insert into validation.platform_element_source (catalog_release_id, element_id, source_key)
select e.release_id, e.element_id,
  case when e.element_id = 'eRecord.01' then 'report-identity' else 'dispatch-ingestion' end
from catalog.element_definition e
where e.element_id = any(array[
  'eRecord.01', 'eResponse.03', 'eResponse.04', 'eResponse.13', 'eResponse.14',
  'eDispatch.01', 'eDispatch.05', 'eTimes.02', 'eTimes.03', 'eTimes.14'
]::text[])
on conflict do nothing;

alter table validation.version
  add constraint validation_version_organization_id_catalog_unique
  unique (organization_id, id, catalog_release_id);

create table app_identity.active_configuration_bundle (
  organization_id uuid primary key references app_identity.organization(id),
  form_version_id uuid not null,
  catalog_release_id uuid not null references catalog.release(id),
  validation_version_id uuid not null,
  form_definition_sha256 text not null check (form_definition_sha256 ~ '^[a-f0-9]{64}$'),
  catalog_artifact_sha256 text not null check (catalog_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  validation_compiled_sha256 text not null check (validation_compiled_sha256 ~ '^[a-f0-9]{64}$'),
  activated_by uuid not null,
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  activated_at timestamptz not null default now(),
  foreign key (form_version_id, catalog_release_id)
    references forms.form_version(id, catalog_release_id),
  foreign key (organization_id, validation_version_id, catalog_release_id)
    references validation.version(organization_id, id, catalog_release_id),
  foreign key (organization_id, activated_by)
    references app_identity.app_user(organization_id, id)
);

create index active_configuration_form_version_idx
  on app_identity.active_configuration_bundle (form_version_id);
create index active_configuration_catalog_release_idx
  on app_identity.active_configuration_bundle (catalog_release_id);
create index active_configuration_validation_version_idx
  on app_identity.active_configuration_bundle (validation_version_id);

create function app_identity.validate_active_configuration_bundle()
returns trigger language plpgsql as $$
declare
  form_row record;
  catalog_row record;
  validation_row record;
  missing_elements text[];
begin
  select f.organization_id, fv.status, fv.definition_sha256
    into form_row
  from forms.form_version fv
  join forms.form f on f.id = fv.form_id
  where fv.id = new.form_version_id
    and fv.catalog_release_id = new.catalog_release_id;

  select sealed, artifact_sha256 into catalog_row
  from catalog.release where id = new.catalog_release_id;

  select status, compiled_sha256, compiled_bundle into validation_row
  from validation.version
  where organization_id = new.organization_id
    and id = new.validation_version_id
    and catalog_release_id = new.catalog_release_id;

  if form_row.organization_id is distinct from new.organization_id
     or form_row.status is distinct from 'published'
     or form_row.definition_sha256 is distinct from new.form_definition_sha256 then
    raise exception 'active configuration Form must be published, intact, and owned by the organization';
  end if;
  if catalog_row.sealed is distinct from true
     or catalog_row.artifact_sha256 is distinct from new.catalog_artifact_sha256 then
    raise exception 'active configuration Catalog must be published and intact';
  end if;
  if validation_row.status is distinct from 'published'
     or validation_row.compiled_sha256 is distinct from new.validation_compiled_sha256 then
    raise exception 'active configuration Validation must be published and intact';
  end if;

  with referenced(element_id) as (
    select distinct reference.element_id
    from jsonb_array_elements(validation_row.compiled_bundle->'rules') rule,
    lateral (
      select rule->'primaryTarget'->>'elementId' as element_id
      union all
      select jsonb_array_elements_text(coalesce(rule->'references'->'elementIds', '[]'::jsonb))
    ) reference
    where coalesce((rule->>'enabled')::boolean, false)
      and (rule->'executionTargets' ?| array['live', 'sign'])
  ), available(element_id) as (
    select e.element_id
    from forms.form_field ff
    join catalog.element_definition e
      on e.release_id = new.catalog_release_id
     and e.element_identity_id = ff.catalog_element_identity_id
    where ff.form_version_id = new.form_version_id
    union
    select p.element_id from validation.platform_element_source p
    where p.catalog_release_id = new.catalog_release_id
  )
  select array_agg(referenced.element_id order by referenced.element_id)
    into missing_elements
  from referenced
  where referenced.element_id is not null
    and not exists (select 1 from available where available.element_id = referenced.element_id);

  if cardinality(missing_elements) > 0 then
    raise exception 'active configuration has unavailable live/sign elements: %', array_to_string(missing_elements, ', ');
  end if;
  return new;
end;
$$;

create trigger active_configuration_bundle_validate
before insert or update on app_identity.active_configuration_bundle
for each row execute function app_identity.validate_active_configuration_bundle();

-- Preserve an already-compatible active pair. Installations without one must
-- explicitly activate a complete bundle before creating more reports.
insert into app_identity.active_configuration_bundle
  (organization_id, form_version_id, catalog_release_id, validation_version_id,
   form_definition_sha256, catalog_artifact_sha256, validation_compiled_sha256,
   activated_by, change_note, activated_at)
select d.organization_id, d.form_version_id, fv.catalog_release_id, av.validation_version_id,
  fv.definition_sha256, cr.artifact_sha256, vv.compiled_sha256,
  av.activated_by, av.change_note, av.activated_at
from forms.agency_stationary_default d
join forms.form_version fv on fv.id = d.form_version_id and fv.status = 'published'
join catalog.release cr on cr.id = fv.catalog_release_id and cr.sealed
join validation.active_version av on av.organization_id = d.organization_id
  and av.form_version_id = d.form_version_id
join validation.version vv on vv.organization_id = d.organization_id
  and vv.id = av.validation_version_id and vv.catalog_release_id = fv.catalog_release_id
  and vv.status = 'published';

create function forms.prevent_partial_configuration_activation()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from app_identity.active_configuration_bundle active
    where active.organization_id = new.organization_id
      and active.form_version_id <> new.form_version_id
  ) then
    raise exception 'Form activation must occur through a complete configuration bundle';
  end if;
  return new;
end;
$$;

create trigger agency_stationary_default_bundle_guard
before insert or update on forms.agency_stationary_default
for each row execute function forms.prevent_partial_configuration_activation();

alter table app_identity.configuration_event
  drop constraint configuration_event_action_check,
  add constraint configuration_event_action_check
    check (action in (
      'form.draft_create', 'form.draft_save', 'form.draft_delete',
      'form.publish', 'form.activate', 'configuration.activate'
    )),
  add column validation_version_id uuid references validation.version(id),
  add column previous_validation_version_id uuid references validation.version(id),
  add column form_definition_sha256 text check (form_definition_sha256 is null or form_definition_sha256 ~ '^[a-f0-9]{64}$'),
  add column catalog_artifact_sha256 text check (catalog_artifact_sha256 is null or catalog_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  add column validation_compiled_sha256 text check (validation_compiled_sha256 is null or validation_compiled_sha256 ~ '^[a-f0-9]{64}$');

alter table clinical.report
  add column form_definition_sha256 text check (form_definition_sha256 is null or form_definition_sha256 ~ '^[a-f0-9]{64}$'),
  add column catalog_artifact_sha256 text check (catalog_artifact_sha256 is null or catalog_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  add column validation_compiled_sha256 text check (validation_compiled_sha256 is null or validation_compiled_sha256 ~ '^[a-f0-9]{64}$');

create or replace function clinical.validate_report_validation_pin()
returns trigger language plpgsql as $$
declare
  pinned_validation validation.version%rowtype;
  pinned_form forms.form_version%rowtype;
  pinned_catalog catalog.release%rowtype;
  organization_has_bundle boolean;
begin
  if tg_op = 'UPDATE' and
     (new.validation_version_id, new.form_definition_sha256,
      new.catalog_artifact_sha256, new.validation_compiled_sha256)
     is distinct from
     (old.validation_version_id, old.form_definition_sha256,
      old.catalog_artifact_sha256, old.validation_compiled_sha256) then
    raise exception 'report configuration artifact pins are immutable';
  end if;
  select exists(select 1 from app_identity.active_configuration_bundle
    where organization_id = new.organization_id) into organization_has_bundle;
  if tg_op = 'INSERT' and organization_has_bundle and (new.validation_version_id is null
      or new.form_definition_sha256 is null or new.catalog_artifact_sha256 is null
      or new.validation_compiled_sha256 is null) then
    raise exception 'new reports require complete configuration identity and artifact pins';
  end if;
  if new.validation_version_id is null then return new; end if;

  select * into pinned_validation from validation.version
  where organization_id = new.organization_id and id = new.validation_version_id;
  select * into pinned_form from forms.form_version where id = new.form_version_id;
  select * into pinned_catalog from catalog.release where id = new.catalog_release_id;
  if pinned_validation.status is distinct from 'published'
     or pinned_validation.catalog_release_id <> new.catalog_release_id
     or pinned_validation.compiled_sha256 is distinct from new.validation_compiled_sha256
     or pinned_form.definition_sha256 is distinct from new.form_definition_sha256
     or pinned_catalog.artifact_sha256 is distinct from new.catalog_artifact_sha256 then
    raise exception 'report configuration identities and artifact digests must identify one published bundle';
  end if;
  return new;
end;
$$;

drop trigger report_validation_pin_validate on clinical.report;
create trigger report_validation_pin_validate
before insert or update of validation_version_id, form_definition_sha256,
  catalog_artifact_sha256, validation_compiled_sha256 on clinical.report
for each row execute function clinical.validate_report_validation_pin();

revoke all on table validation.platform_element_source,
  app_identity.active_configuration_bundle from public;
grant select on table validation.platform_element_source to open_triage_api_runtime;
grant select, insert, update on table app_identity.active_configuration_bundle to open_triage_api_runtime;

comment on table app_identity.active_configuration_bundle is
  'The sole complete Form, Catalog, and Validation bundle selected for future reports.';
comment on column clinical.report.form_definition_sha256 is
  'Immutable Form artifact digest pinned when this report was created; null only for a pre-bundle report.';
