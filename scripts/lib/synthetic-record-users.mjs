import { randomUUID } from 'node:crypto';

/** Resolve current agency permissions using the same owner/role-version rules as
 * ClinicianSessionService. Each user appears once regardless of their unit count.
 * This is an operator CLI using DATABASE_URL, not a browser authentication path. */
export async function eligibleAgencyUsers(database, agencyId, { unitId, userId, username, availableOnly = true } = {}) {
  const rows = await database.query(`
    select u.id, u.display_name, organization.name as organization_name,
      jsonb_agg(jsonb_build_object('id',unit.id,'callSign',unit.call_sign,'name',unit.name)
        order by unit.call_sign,unit.id) as units
    from app_identity.app_user u
    join app_identity.organization organization on organization.id=u.organization_id
    join app_identity.unit_clinician membership
      on membership.organization_id=u.organization_id and membership.user_id=u.id
    join app_identity.operational_unit unit
      on unit.organization_id=membership.organization_id and unit.id=membership.unit_id and unit.active
    where u.organization_id=$1 and u.active
      and ($2::uuid is null or unit.id=$2) and ($3::uuid is null or u.id=$3)
      and ($5::text is null or exists (select 1 from app_identity.local_credential credential
        where credential.user_id=u.id and credential.username=lower(trim($5))))
      and exists (select 1 from app_identity.installation_owner installation where installation.organization_id=u.organization_id)
      and not exists (
        select 1 from unnest(array['clinical:document','clinical:demo']::text[]) required(capability_key)
        where not exists (
          select 1 from app_identity.installation_owner owner_record
          where owner_record.organization_id=u.organization_id and owner_record.user_id=u.id
        ) and not exists (
          select 1 from app_identity.user_role_assignment assignment
          join app_identity.role role on role.organization_id=assignment.organization_id and role.id=assignment.role_id
          join app_identity.role_version version on version.organization_id=role.organization_id
            and version.role_id=role.id and version.id=role.current_version_id
          join app_identity.role_version_capability capability on capability.organization_id=version.organization_id
            and capability.role_id=version.role_id and capability.role_version_id=version.id
          where assignment.organization_id=u.organization_id and assignment.user_id=u.id
            and assignment.ended_at is null and role.active and role.assignable
            and capability.capability_key=required.capability_key
        )
      )
      and (not $4::boolean or not exists (
        select 1 from clinical.call_assignment pending
        where pending.organization_id=u.organization_id and pending.unit_id=unit.id
          and pending.synthetic_generated_by=u.id and pending.synthetic and pending.status='assigned'
          and (pending.expires_at is null or pending.expires_at>clock_timestamp())
      ))
    group by u.id,u.display_name,organization.name order by u.id
  `, [agencyId, unitId ?? null, userId ?? null, availableOnly, username ?? null]);
  return rows;
}

export function selectAgencyUser(users, random) {
  if (!users.length) throw new Error('No active agency users have Demo and documentation permissions with an available assigned unit');
  const user = users[Math.floor(random() * users.length)];
  const unit = user.units[Math.floor(random() * user.units.length)];
  return { user, unit };
}

/** Process-local authority for a selected user, scoped to synthetic generation.
 * Re-check current permissions through the transaction manager on every service
 * call. No app sessions, credentials, roles or unit memberships are created. */
export function agencyUserContext(database, agencyId, user) {
  const sessionToken = randomUUID(), csrfToken = randomUUID();
  const startedAt = new Date().toISOString();
  const session = {
    user: { id: user.id, displayName: user.display_name },
    organization: { id: agencyId, name: user.organization_name },
    csrfToken, startedAt, capabilities: ['clinical:document', 'clinical:demo'],
  };
  const sessions = {
    async requireCapability(token, capability, manager = database) {
      if (token !== sessionToken || !session.capabilities.includes(capability)) throw new Error('Invalid synthetic CLI authority');
      const [current] = await eligibleAgencyUsers(manager, agencyId, { userId: user.id, availableOnly: false });
      if (!current) throw new Error(`Selected user ${user.id} no longer has Demo/documentation permissions or an active assigned unit`);
      return session;
    },
    async assertCsrf(token, csrf, manager = database) {
      if (csrf !== csrfToken) throw new Error('Invalid synthetic CLI CSRF token');
      await this.requireCapability(token, 'clinical:demo', manager);
    },
  };
  return { session, sessionToken, sessions };
}
