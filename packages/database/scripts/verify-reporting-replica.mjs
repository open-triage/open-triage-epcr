import pg from "pg";

const databaseUrl = process.env.REPORTING_REPLICA_DATABASE_URL;
const role = process.env.REPORTING_REPLICA_ROLE ?? "open_triage_analyst";
const allowPrimary = process.env.ALLOW_PRIMARY_REPLICA_TEST === "1";
const contracts = {
  open_triage_analyst: [
    "analytics.epcr", "analytics.epcr_repeatable_element", "analytics.element_dictionary", "analytics.agency"
  ],
  open_triage_identified_analyst: [
    "analytics.epcr", "analytics.epcr_repeatable_element", "analytics.element_dictionary", "analytics.agency",
    "analytics.epcr_identified", "analytics.epcr_repeatable_element_identified"
  ]
};

if (!databaseUrl) throw new Error("REPORTING_REPLICA_DATABASE_URL is required");
if (!Object.hasOwn(contracts, role)) throw new Error("REPORTING_REPLICA_ROLE must be an approved analyst role");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const state = (await client.query("select pg_is_in_recovery() as is_replica")).rows[0];
  if (!state.is_replica && !allowPrimary) throw new Error("reporting endpoint is not a physical standby");

  const isolation = (await client.query(`select
    has_table_privilege($1, 'analytics_private.epcr', 'select') as private_epcr,
    has_table_privilege($1, 'clinical.report', 'select') as clinical_report
  `, [role])).rows[0];
  if (isolation.private_epcr || isolation.clinical_report) {
    throw new Error("reporting role has access to private database tables");
  }

  await client.query("begin read only");
  await client.query(`set local role ${role}`);
  for (const contract of contracts[role]) await client.query(`select * from ${contract} limit 0`);
  const readOnly = (await client.query(
    "select current_setting('transaction_read_only') = 'on' as enabled"
  )).rows[0].enabled;
  if (!readOnly) {
    throw new Error("reporting role is not isolated to read-only analyst contracts");
  }
  await client.query("commit");
  console.log(JSON.stringify({
    event: "reporting_replica_role_verification",
    status: "succeeded",
    role,
    physicalStandby: state.is_replica,
    readOnly: true,
    contractCount: contracts[role].length,
    privateAccess: false
  }));
} catch (error) {
  try { await client.query("rollback"); } catch { /* connection may already be unavailable */ }
  const code = error && typeof error === "object" && "code" in error
    ? `database.${String(error.code).slice(0, 32)}`
    : "replica.VerificationFailed";
  console.log(JSON.stringify({ event: "reporting_replica_role_verification", status: "failed", errorCode: code }));
  process.exitCode = 1;
} finally {
  await client.end();
}
