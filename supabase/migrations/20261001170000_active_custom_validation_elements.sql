create or replace function app_identity.validate_active_configuration_bundle()
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
    select ced.namespace || '.' || ced.slug
    from forms.form_field ff
    join forms.custom_element_definition ced
      on ced.id = ff.custom_element_definition_id
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
