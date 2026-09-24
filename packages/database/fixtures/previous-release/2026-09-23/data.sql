begin;

insert into app_identity.organization (id, name, deployment_timezone)
values (
  '51300000-0000-4000-8000-000000000001',
  'Sanitized N-1 Upgrade Fixture',
  'UTC'
);

insert into app_identity.app_user (id, organization_id, display_name, synthetic)
values (
  '51300000-0000-4000-8000-000000000002',
  '51300000-0000-4000-8000-000000000001',
  'Fictional Upgrade Owner',
  true
);

insert into app_identity.installation_owner
  (organization_id, user_id, established_by_operator_id)
values (
  '51300000-0000-4000-8000-000000000001',
  '51300000-0000-4000-8000-000000000002',
  'sanitized-ci-fixture'
);

insert into catalog.release
  (id, standard, version, dataset, artifact_schema_version, artifact_sha256, provenance, sealed)
values (
  '51300000-0000-4000-8000-000000000003',
  'OPEN-TRIAGE-CI',
  'n-1-2026-09-23',
  'sanitized-upgrade-fixture',
  '1',
  '5135135135135135135135135135135135135135135135135135135135135135',
  '{"source":"synthetic-ci-fixture","containsPhi":false,"bounded":true}'::jsonb,
  true
);

commit;
