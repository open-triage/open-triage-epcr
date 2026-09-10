-- A report is a durable reference to the exact published clinical configuration
-- selected when it was created. Activation only moves the agency default used by
-- future reports; it must never provide a path to rewrite an existing report.

alter table forms.form_version
  add constraint form_version_id_catalog_release_unique
  unique (id, catalog_release_id);

alter table clinical.report
  add constraint report_form_version_catalog_release_fk
  foreign key (form_version_id, catalog_release_id)
  references forms.form_version (id, catalog_release_id);

create function clinical.validate_report_configuration_pin()
returns trigger
language plpgsql
as $$
declare
  pinned_configuration_is_valid boolean;
begin
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.incident_id, new.patient_id,
        new.agency_demographic_version_id, new.form_version_id,
        new.catalog_release_id, new.documenting_user_id)
       is distinct from
       (old.organization_id, old.incident_id, old.patient_id,
        old.agency_demographic_version_id, old.form_version_id,
        old.catalog_release_id, old.documenting_user_id) then
      raise exception 'report % identity and pinned configuration are immutable', old.id;
    end if;
    return new;
  end if;

  select fv.status = 'published' and f.organization_id = new.organization_id
    into pinned_configuration_is_valid
  from forms.form_version fv
  join forms.form f on f.id = fv.form_id
  where fv.id = new.form_version_id
    and fv.catalog_release_id = new.catalog_release_id;

  if pinned_configuration_is_valid is distinct from true then
    raise exception 'report configuration must be a published form version from the same organization';
  end if;
  return new;
end;
$$;

create trigger report_configuration_pin_validate
before insert or update of organization_id, incident_id, patient_id,
  agency_demographic_version_id, form_version_id, catalog_release_id,
  documenting_user_id on clinical.report
for each row execute function clinical.validate_report_configuration_pin();
