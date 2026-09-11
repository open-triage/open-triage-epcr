-- Revision 3 makes the two demonstration identities ordinary local accounts.
-- This one-time data revision replaces legacy broad role assignments; subsequent
-- fixture bootstrap replays are deliberately insert-only and cannot undo later
-- account administration.
update app_identity.app_user app_user
set synthetic = false
from app_identity.local_credential credential
where credential.user_id = app_user.id
  and (credential.username, app_user.id) in (
    ('demo.admin', '32000000-0000-4000-8000-000000000002'::uuid),
    ('demo.clinician', '32000000-0000-4000-8000-000000000003'::uuid)
  )
  and app_user.synthetic;

delete from app_identity.external_identity
where provider = 'synthetic-bootstrap'
  and user_id in (
    '32000000-0000-4000-8000-000000000002',
    '32000000-0000-4000-8000-000000000003'
  );

update app_identity.user_role_assignment assignment
set ended_at = now(), ended_by = assignment.user_id,
    note = 'Replaced by demonstration fixture revision 3'
from app_identity.role role, app_identity.local_credential credential
where role.id = assignment.role_id
  and role.organization_id = assignment.organization_id
  and credential.user_id = assignment.user_id
  and (credential.username, assignment.user_id) in (
    ('demo.admin', '32000000-0000-4000-8000-000000000002'::uuid),
    ('demo.clinician', '32000000-0000-4000-8000-000000000003'::uuid)
  )
  and assignment.ended_at is null
  and (
    (credential.username = 'demo.admin'
      and role.system_key not in ('configuration-author', 'clinical-demo'))
    or
    (credential.username = 'demo.clinician' and role.system_key <> 'clinical-demo')
  );

insert into app_identity.user_role_assignment
  (organization_id, user_id, role_id, assigned_by, note)
select app_user.organization_id, app_user.id, role.id, app_user.id,
  'Demonstration fixture revision 3'
from app_identity.app_user app_user
join app_identity.local_credential credential on credential.user_id = app_user.id
join app_identity.role role on role.organization_id = app_user.organization_id
where (
    credential.username = 'demo.admin'
    and app_user.id = '32000000-0000-4000-8000-000000000002'
    and role.system_key in ('configuration-author', 'clinical-demo')
  ) or (
    credential.username = 'demo.clinician'
    and app_user.id = '32000000-0000-4000-8000-000000000003'
    and role.system_key = 'clinical-demo'
  )
on conflict (user_id, role_id) where ended_at is null do nothing;

insert into app_identity.authentication_event
  (organization_id, actor_id, action, result, target_user_id, details)
select app_user.organization_id, app_user.id, 'account.roles_change', 'succeeded', app_user.id,
  jsonb_build_object(
    'source', 'demonstration-fixture-revision',
    'revision', 3,
    'roleKeys', case credential.username
      when 'demo.admin' then to_jsonb(array['configuration-author', 'clinical-demo']::text[])
      else to_jsonb(array['clinical-demo']::text[])
    end
  )
from app_identity.app_user app_user
join app_identity.local_credential credential on credential.user_id = app_user.id
where (credential.username, app_user.id) in (
  ('demo.admin', '32000000-0000-4000-8000-000000000002'::uuid),
  ('demo.clinician', '32000000-0000-4000-8000-000000000003'::uuid)
);
