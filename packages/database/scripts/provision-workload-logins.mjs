import { pathToFileURL } from "node:url";
import pg from "pg";

const workloadContracts = Object.freeze([
  { key: "API", portableRole: "open_triage_api_runtime", connectionLimit: 20 },
  { key: "ANALYTICS_PROJECTOR", portableRole: "open_triage_analytics_projector", connectionLimit: 5 },
  { key: "ANALYTICS_HEALTH", portableRole: "open_triage_analytics_health", connectionLimit: 5 },
  { key: "RETENTION", portableRole: "open_triage_retention", connectionLimit: 5 },
  { key: "OPERATIONAL_AUDIT", portableRole: "open_triage_operational_audit_writer", connectionLimit: 5 },
]);

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function workloadCredentials(environment = process.env) {
  return workloadContracts.map((contract) => {
    const login = environment[`${contract.key}_DATABASE_LOGIN`];
    const password = environment[`${contract.key}_DATABASE_PASSWORD`];
    if (!login || !/^open_triage_demo_[a-z_]+_[a-f0-9]{12}$/.test(login)) {
      throw new Error(`${contract.key}_DATABASE_LOGIN must be an installation-specific login name`);
    }
    if (!password || password.length < 32) {
      throw new Error(`${contract.key}_DATABASE_PASSWORD must contain at least 32 characters`);
    }
    return { ...contract, login, password };
  });
}

export async function provisionWorkloadLogins({
  databaseUrl = process.env.DATABASE_URL,
  credentials = workloadCredentials(),
  Client = pg.Client,
  log = console,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to provision workload logins");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    for (const credential of credentials) {
      const portable = await client.query(
        `select rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         from pg_roles where rolname = $1`,
        [credential.portableRole],
      );
      const role = portable.rows[0];
      if (!role || role.rolcanlogin || role.rolsuper || role.rolcreaterole ||
          role.rolcreatedb || role.rolbypassrls) {
        throw new Error(`Portable role ${credential.portableRole} is missing or unsafe`);
      }

      const existing = await client.query(
        `select rolcanlogin, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls
         from pg_roles where rolname = $1`,
        [credential.login],
      );
      const loginRole = existing.rows[0];
      if (loginRole && (!loginRole.rolcanlogin || loginRole.rolsuper || loginRole.rolcreaterole ||
          loginRole.rolcreatedb || loginRole.rolbypassrls)) {
        throw new Error(`Existing login ${credential.login} has an unsafe role contract`);
      }

      const login = quoteIdentifier(credential.login);
      const password = quoteLiteral(credential.password);
      if (loginRole) {
        await client.query(`alter role ${login} with password ${password}
          connection limit ${credential.connectionLimit}`);
      } else {
        await client.query(`create role ${login} login nosuperuser nocreatedb nocreaterole
          inherit nobypassrls connection limit ${credential.connectionLimit} password ${password}`);
      }
      await client.query(`grant ${quoteIdentifier(credential.portableRole)} to ${login}`);
      log.info(`Provisioned isolated login for ${credential.portableRole}`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await provisionWorkloadLogins();
}
