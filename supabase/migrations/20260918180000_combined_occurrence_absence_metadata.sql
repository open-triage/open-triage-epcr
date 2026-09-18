-- Preserve the ordinary occurrence payload independently from NEMSIS NV and PN attributes.
alter table clinical.element_occurrence
  add column not_value_code text,
  add column not_value_display text,
  add column pertinent_negative_code text,
  add column pertinent_negative_display text;

alter table analytics_private.epcr_repeatable_element
  add column not_value_code text,
  add column not_value_display text,
  add column pertinent_negative_code text,
  add column pertinent_negative_display text;

alter table clinical.element_occurrence
  add constraint element_occurrence_not_value_display_requires_code
    check (not_value_code is not null or not_value_display is null),
  add constraint element_occurrence_pertinent_negative_display_requires_code
    check (pertinent_negative_code is not null or pertinent_negative_display is null),
  add constraint element_occurrence_legacy_absence_metadata_matches
    check ((value_kind <> 'null' or not_value_code is null or absence_code is not distinct from not_value_code)
       and (value_kind <> 'pertinent-negative' or pertinent_negative_code is null
         or absence_code is not distinct from pertinent_negative_code));

create or replace function clinical.validate_element_occurrence_mapping()
returns trigger
language plpgsql
as $$
declare
  identity_namespace text;
  standard_mapping catalog.analytics_element_mapping%rowtype;
  custom_definition forms.custom_element_definition%rowtype;
  custom_repeatable boolean;
  allowed_custom_states text[];
begin
  if new.value_kind = 'null' and new.absence_code is not null and new.not_value_code is null then
    new.not_value_code := new.absence_code;
    new.not_value_display := new.absence_display;
  elsif new.value_kind = 'pertinent-negative' and new.absence_code is not null and new.pertinent_negative_code is null then
    new.pertinent_negative_code := new.absence_code;
    new.pertinent_negative_display := new.absence_display;
  end if;
  select namespace into identity_namespace from catalog.element_identity where id = new.element_identity_id;
  if new.form_field_id is not null and not exists (
    select 1 from forms.form_field field
    join clinical.report report on report.form_version_id = field.form_version_id
    where field.id = new.form_field_id and report.id = new.report_id
  ) then
    raise exception 'form field % does not belong to report % form version', new.form_field_id, new.report_id;
  end if;
  if identity_namespace = 'NEMSIS' then
    select * into standard_mapping
    from catalog.analytics_element_mapping
    where release_id = new.catalog_release_id and element_id = new.element_id;
    if not found or standard_mapping.element_identity_id <> new.element_identity_id then
      raise exception 'element % does not belong to catalog release %', new.element_id, new.catalog_release_id;
    end if;
    if (standard_mapping.analytical_location = 'repeatable') <> new.analytical_repeatable then
      raise exception 'analytical repeatability for % does not match the catalog mapping', new.element_id;
    end if;
    if standard_mapping.identifying <> new.identifying then
      raise exception 'identifying classification for % does not match the catalog mapping', new.element_id;
    end if;
    if new.not_value_code is not null and not exists (
      select 1 from catalog.element_definition e
      join catalog.element_option o on o.release_id=e.release_id and o.element_id=e.element_id
        and o.source_kind='not-value' and o.code=new.not_value_code
      where e.release_id=new.catalog_release_id and e.element_id=new.element_id and e.supports_not_values
    ) then raise exception 'not-value % is not supported for element %', new.not_value_code, new.element_id;
    end if;
    if new.pertinent_negative_code is not null and not exists (
      select 1 from catalog.element_definition e
      join catalog.element_option o on o.release_id=e.release_id and o.element_id=e.element_id
        and o.source_kind='pertinent-negative' and o.code=new.pertinent_negative_code
      where e.release_id=new.catalog_release_id and e.element_id=new.element_id and e.supports_pertinent_negatives
    ) then raise exception 'pertinent-negative % is not supported for element %', new.pertinent_negative_code, new.element_id;
    end if;
  else
    select * into custom_definition from forms.custom_element_definition where id = new.element_identity_id;
    if not found then raise exception 'custom element identity % is not defined', new.element_identity_id; end if;
    if new.element_id <> custom_definition.namespace || '.' || custom_definition.slug then
      raise exception 'custom element key % does not match identity %', new.element_id, new.element_identity_id;
    end if;
    if new.identifying <> custom_definition.identifying then
      raise exception 'identifying classification for custom element % does not match its definition', new.element_id;
    end if;
    if new.form_field_id is null then raise exception 'custom element % requires a form field', new.element_id; end if;
    select analytical_repeatable, allowed_absence_states into custom_repeatable, allowed_custom_states
    from forms.form_field where id = new.form_field_id;
    if custom_repeatable <> new.analytical_repeatable then
      raise exception 'analytical repeatability for custom element % does not match its form field', new.element_id;
    end if;
    if new.not_value_code is not null and not (new.not_value_code = any(allowed_custom_states)) then
      raise exception 'not-value % is not supported for custom element %', new.not_value_code, new.element_id;
    end if;
    if new.pertinent_negative_code is not null and not (new.pertinent_negative_code = any(allowed_custom_states)) then
      raise exception 'pertinent-negative % is not supported for custom element %', new.pertinent_negative_code, new.element_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger element_occurrence_mapping_validate on clinical.element_occurrence;
create trigger element_occurrence_mapping_validate
before insert or update of catalog_release_id, element_identity_id, element_id,
  analytical_repeatable, identifying, form_field_id, not_value_code, pertinent_negative_code
on clinical.element_occurrence
for each row execute function clinical.validate_element_occurrence_mapping();
