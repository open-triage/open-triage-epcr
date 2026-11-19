-- A shipped rule version is stored once and kept for the encounters that pin it.
create table catalog.decision_support_definition (
  id uuid primary key default gen_random_uuid(),
  system_key text not null,
  version text not null,
  -- Object order is significant for definition-driven choices.
  definition json not null check (json_typeof(definition) = 'object'),
  unique (system_key, version),
  check (definition->>'key' is not distinct from system_key),
  check (definition->>'version' is not distinct from version)
);

revoke update, delete, truncate on catalog.decision_support_definition from open_triage_api_runtime;
grant select, insert on catalog.decision_support_definition to open_triage_api_runtime;

alter table app_identity.agency_settings
  add column decision_support_system text;

alter table app_identity.agency_settings_change_event
  add column old_decision_support_system text,
  add column new_decision_support_system text;

alter table clinical.report
  add column decision_support_definition_id uuid references catalog.decision_support_definition(id);

create function clinical.keep_report_decision_support_pin()
returns trigger
language plpgsql
as $$
begin
  if new.decision_support_definition_id is distinct from old.decision_support_definition_id then
    raise exception 'report % decision support pin is immutable', old.id;
  end if;
  return new;
end;
$$;

create trigger report_decision_support_pin_immutable
before update of decision_support_definition_id on clinical.report
for each row execute function clinical.keep_report_decision_support_pin();
