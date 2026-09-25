-- The original synthetic bootstrap populated dAgency.02 and dAgency.04 with
-- invalid values. Preserve that immutable version for reports that already pin
-- it, and append a standards-valid demographic only when the known bad fixture
-- is still current.
with current_demographic as (
  select demographic.*
  from app_identity.agency_demographic_version demographic
  where demographic.organization_id = '32000000-0000-4000-8000-000000000001'
  order by demographic.effective_from desc, demographic.version desc
  limit 1
)
insert into app_identity.agency_demographic_version
  (id, organization_id, catalog_release_id, version, dagency_01, dagency_02,
   dagency_04, dagency_04_display, dagency_04_system,
   dagency_04_terminology_version, definition_sha256, effective_from, created_by)
select
  '35000000-0000-4000-8000-000000000002', organization_id,
  catalog_release_id, version + 1, dagency_01, 'DEMO-EMS',
  '36', 'New York', 'ANSI-STATE', null,
  'c670db53dcbd415dd9e9883db7c268896c52fa253897e7af20b2c1f850e418bb',
  clock_timestamp(), created_by
from current_demographic
where id = '35000000-0000-4000-8000-000000000001'
  and dagency_01 = 'DEMO-EMS'
  and dagency_02 = 'Demonstration EMS'
  and dagency_04 = '9920003'
  and dagency_04_display = 'Emergency Medical Services'
  and dagency_04_system is null
  and dagency_04_terminology_version is null;
