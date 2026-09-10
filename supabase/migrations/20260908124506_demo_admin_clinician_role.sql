-- Keep existing synthetic installations aligned with the idempotent bootstrap:
-- the demo administrator can switch between administration and clinical documentation.
insert into app_identity.capability (key, description)
values ('clinical:document', 'Create and document patient care reports')
on conflict (key) do nothing;

insert into app_identity.user_capability (user_id, capability_key, granted_by)
select credential.user_id, capability.key, credential.user_id
from app_identity.local_credential credential
cross join (values ('clinical:document'), ('reports:document')) capability(key)
where credential.username = 'demo.admin'
on conflict (user_id, capability_key) do nothing;

insert into app_identity.unit_clinician (organization_id, unit_id, user_id)
select unit.organization_id, unit.id, credential.user_id
from app_identity.local_credential credential
join app_identity.app_user app_user on app_user.id = credential.user_id
join app_identity.operational_unit unit
  on unit.organization_id = app_user.organization_id and unit.synthetic
where credential.username = 'demo.admin'
on conflict (unit_id, user_id) do nothing;
