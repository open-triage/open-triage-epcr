-- Portable role-package operations are audited without embedding role names,
-- capability definitions, assignment identities, or package contents.
alter table app_identity.authorization_event
  drop constraint authorization_event_action_check;
alter table app_identity.authorization_event
  add constraint authorization_event_action_check check (action in (
    'capability.register', 'capability.change',
    'role.protected_register', 'role.version_activate',
    'role.deactivate', 'role.reactivate',
    'role.package_export', 'role.package_preview', 'role.package_import'
  ));

alter table app_identity.authorization_event
  drop constraint authorization_event_target_type_check;
alter table app_identity.authorization_event
  add constraint authorization_event_target_type_check check (
    target_type in ('capability', 'role', 'role_version', 'role_package')
  );
