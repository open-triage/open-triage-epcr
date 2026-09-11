-- Retain an append-only audit trail for Stationary form draft creation, saves,
-- and deletion. Drafts are identified durably in event details because the
-- append-only audit row must not retain a foreign key that blocks deletion.

alter table app_identity.configuration_event
  drop constraint configuration_event_action_check,
  alter column form_version_id drop not null,
  add constraint configuration_event_action_check check (action in (
    'form.draft_create', 'form.draft_save', 'form.draft_delete',
    'form.publish', 'form.activate'
  ));
