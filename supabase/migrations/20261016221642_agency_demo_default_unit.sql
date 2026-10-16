-- An optional agency-local default for Demo users; explicit device bindings win.
alter table app_identity.agency_settings
  add column demo_unit_id uuid,
  add constraint agency_settings_demo_unit_fk foreign key (organization_id, demo_unit_id)
    references app_identity.operational_unit(organization_id, id);
-- organization_id is already the primary key, covering the referencing lookup.
alter table app_identity.agency_settings_change_event
  add column old_demo_unit_id uuid,
  add column new_demo_unit_id uuid;
