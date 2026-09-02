import "dotenv/config";
import { derivePatientKey, patientKeyConfigFromEnvironment } from "@open-triage/contracts/patient-key";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to rotate patient keys");
const config = patientKeyConfigFromEnvironment(process.env);
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query("begin");
  await client.query("select pg_advisory_xact_lock(hashtext('open-triage-patient-key-rotation'))");
  const patients = await client.query(`
    select id, organization_id, pseudonymous_key, pseudonymous_key_version
    from clinical.patient order by organization_id, id for update
  `);
  const stale = patients.rows.filter((row) =>
    row.pseudonymous_key_version !== config.keyVersion ||
    row.pseudonymous_key !== derivePatientKey(config, row.organization_id, row.id)
  );
  if (stale.some((row) => row.pseudonymous_key_version >= config.keyVersion)) {
    throw new Error("PATIENT_KEY_VERSION must be greater than every patient key version being rotated");
  }
  for (const row of stale) {
    await client.query(`
      update clinical.patient
      set pseudonymous_key = $2, pseudonymous_key_version = $3
      where id = $1
    `, [row.id, derivePatientKey(config, row.organization_id, row.id), config.keyVersion]);
  }
  await client.query(`
    update analytics_private.epcr projection
    set patient_key = patient.pseudonymous_key,
        patient_key_version = patient.pseudonymous_key_version
    from clinical.report report
    join clinical.patient patient on patient.id = report.patient_id
    where projection.report_id = report.id
      and (projection.patient_key, projection.patient_key_version)
        is distinct from (patient.pseudonymous_key, patient.pseudonymous_key_version)
  `);
  await client.query(`
    update analytics_private.epcr_repeatable_element projection
    set patient_key = patient.pseudonymous_key,
        patient_key_version = patient.pseudonymous_key_version
    from clinical.report report
    join clinical.patient patient on patient.id = report.patient_id
    where projection.report_id = report.id
      and (projection.patient_key, projection.patient_key_version)
        is distinct from (patient.pseudonymous_key, patient.pseudonymous_key_version)
  `);
  await client.query("commit");
  console.log(JSON.stringify({ event: "patient_key_rotation", keyVersion: config.keyVersion, rotatedPatients: stale.length }));
} catch (error) {
  await client.query("rollback");
  throw error;
} finally {
  await client.end();
}
