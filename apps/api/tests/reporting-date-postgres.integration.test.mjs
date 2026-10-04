import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { SignReportService } from '../dist/reports/sign-report.service.js';

const integration = process.env.DATABASE_URL ? test : test.skip;
integration('reporting date uses the earliest valid eTimes value, independently of demographic and documentation dates', async t => {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  t.after(async () => { await client.query('rollback'); await client.end(); });
  await client.query('begin');
  // Temporary occurrence rows exercise the production SQL without creating
  // reports or modifying any existing clinical records.
  await client.query(`create temporary table reporting_date_occurrences (
    report_id uuid, element_id text, value_kind text, value_datetime timestamptz,
    value_date date, documented_time timestamptz, server_received_time timestamptz,
    absence_code text, not_value_code text, pertinent_negative_code text, tombstoned_at timestamptz
  ) on commit drop`);
  const reportId = randomUUID(), otherReportId = randomUUID();
  const row = (element_id, value_datetime, extra = {}) => ({ report_id: reportId, element_id,
    value_kind: 'datetime', value_datetime, server_received_time: '2026-10-05T08:00:00Z', ...extra });
  const rows = [
    row('ePatient.17', null, { value_kind: 'date', value_date: '1942-03-03' }),
    row('ePayment.60', null, { value_kind: 'date', value_date: '2000-01-01' }),
    row('eVitals.01', '2020-01-01T00:00:00Z', { documented_time: '2010-01-01T00:00:00Z' }),
    row('eTimes.03', '2026-10-04T12:00:00Z'),
    row('eTimes.02', '2026-10-04T00:15:00+02:00'),
    row('eTimes.01', '2026-10-02T00:00:00Z', { tombstoned_at: '2026-10-05T00:00:00Z' }),
    row('eTimes.04', '2026-10-01T00:00:00Z', { not_value_code: '7701003' }),
    row('eTimes.05', '2026-09-01T00:00:00Z', { pertinent_negative_code: '8801001' }),
    row('eTimes.06', '2026-08-01T00:00:00Z', { absence_code: '7701003' }),
    row('eTimes.07', '-infinity'),
    row('eTimes.01', '1900-01-01T00:00:00Z', { report_id: otherReportId }),
  ];
  await client.query(`insert into reporting_date_occurrences select * from jsonb_to_recordset($1::jsonb) as occurrence(
    report_id uuid, element_id text, value_kind text, value_datetime timestamptz,
    value_date date, documented_time timestamptz, server_received_time timestamptz,
    absence_code text, not_value_code text, pertinent_negative_code text, tombstoned_at timestamptz
  )`, [JSON.stringify(rows)]);
  const manager = { query: async (sql, parameters) => (await client.query(
    sql.replace('from clinical.element_occurrence', 'from pg_temp.reporting_date_occurrences'), parameters)).rows };
  const service = new SignReportService({}, {});
  const report = { id: reportId, reporting_date: null };
  const signedAt = '2026-10-06T00:00:00Z';
  assert.deepEqual(await service.reportingDate(manager, report, signedAt),
    { date: '2026-10-03', source: 'earliest-clinical-time' });
  await client.query("delete from reporting_date_occurrences where element_id like 'eTimes.%'");
  assert.deepEqual(await service.reportingDate(manager, report, signedAt),
    { date: '2026-10-05', source: 'earliest-server-time' });
  await client.query('delete from reporting_date_occurrences');
  assert.deepEqual(await service.reportingDate(manager, report, signedAt),
    { date: '2026-10-06', source: 'signing-time' });
});
