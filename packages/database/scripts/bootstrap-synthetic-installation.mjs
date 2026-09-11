import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { SYNTHETIC_DEMO_FIXTURE } from "@open-triage/contracts";
import { createPasswordVerifier } from "../../../apps/api/dist/identity/password.js";
import { applyMigrations, readMigrations } from "./migrate.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to bootstrap demonstration fixture accounts");

const accounts = Object.freeze([
  {
    id: SYNTHETIC_DEMO_FIXTURE.administratorUserId,
    username: SYNTHETIC_DEMO_FIXTURE.administratorUsername,
    displayName: "Demonstration Configuration Author",
    roles: ["configuration-author", "clinical-demo"],
  },
  {
    id: SYNTHETIC_DEMO_FIXTURE.clinicianUserId,
    username: SYNTHETIC_DEMO_FIXTURE.clinicianUsername,
    displayName: "Demonstration Clinician",
    roles: ["clinical-demo"],
  },
]);

async function ensureFoundation(client) {
  const migrations = await readMigrations(path.join(repoRoot, "supabase/migrations"));
  return (await applyMigrations(client, migrations, { info() {} })) > 0;
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const migrated = await ensureFoundation(client);
  const passwordVerifier = await createPasswordVerifier(SYNTHETIC_DEMO_FIXTURE.password);
  await client.query("begin");
  try {
    await client.query("select pg_advisory_xact_lock(hashtext('open-triage-demo-fixture-accounts-v3'))");
    const organization = await client.query(
      "select id from app_identity.organization where id = $1 for update",
      [SYNTHETIC_DEMO_FIXTURE.organizationId],
    );
    if (!organization.rows[0]) {
      throw new Error(`Create the demonstration organization ${SYNTHETIC_DEMO_FIXTURE.organizationId} before seeding fixture accounts`);
    }

    const created = [];
    for (const account of accounts) {
      const inserted = await client.query(`
        insert into app_identity.app_user (id, organization_id, display_name)
        values ($1, $2, $3)
        on conflict (id) do nothing
        returning id
      `, [account.id, SYNTHETIC_DEMO_FIXTURE.organizationId, account.displayName]);
      if (!inserted.rows[0]) continue;

      await client.query(`
        insert into app_identity.local_credential
          (user_id, username, password_verifier, must_change_password,
           temporary_password_expires_at, password_changed_at)
        values ($1, $2, $3, false, null, now())
      `, [account.id, account.username, passwordVerifier]);

      const assignments = await client.query(`
        insert into app_identity.user_role_assignment
          (organization_id, user_id, role_id, assigned_by, note)
        select $1, $2, role.id, $2, 'Initial demonstration fixture assignment'
        from app_identity.role role
        where role.organization_id = $1 and role.system_key = any($3::text[])
          and role.protected and role.active and role.assignable
        returning role_id
      `, [SYNTHETIC_DEMO_FIXTURE.organizationId, account.id, account.roles]);
      if (assignments.rowCount !== account.roles.length) {
        throw new Error(`The protected roles for ${account.username} are unavailable`);
      }
      await client.query(`
        insert into app_identity.authentication_event
          (organization_id, actor_id, action, result, target_user_id, details)
        values ($1, $2, 'account.provision', 'succeeded', $2,
          jsonb_build_object('source', 'demonstration-fixture', 'roleKeys', $3::text[]))
      `, [SYNTHETIC_DEMO_FIXTURE.organizationId, account.id, account.roles]);
      created.push(account.username);
    }

    const owner = await client.query(
      "select exists (select 1 from app_identity.installation_owner where organization_id = $1) as configured",
      [SYNTHETIC_DEMO_FIXTURE.organizationId],
    );
    await client.query("commit");
    console.log(JSON.stringify({
      status: "ready",
      fixture: SYNTHETIC_DEMO_FIXTURE.id,
      revision: SYNTHETIC_DEMO_FIXTURE.revision,
      migrated,
      organizationId: SYNTHETIC_DEMO_FIXTURE.organizationId,
      createdAccounts: created,
      ownerConfigured: Boolean(owner.rows[0]?.configured),
    }, null, 2));
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
} finally {
  await client.end();
}
