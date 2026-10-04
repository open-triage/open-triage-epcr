import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { randomFromSeed } from '@open-triage/contracts/synthetic-record-generator';

export const HELP = `Generate synthetic records using an agency's active form, catalog and validation.

Usage: npm run generate:synthetic -- --agency UUID [--username USER] --count N --from YYYY-MM-DD --to YYYY-MM-DD

  --agency UUID       Required organization ID
  --username USER     Optional fixed clinician; omit to distribute randomly across eligible agency users
  --count N           Number of records, 1–10000
  --from DATE         First service date, inclusive, UTC
  --to DATE           Last service date, inclusive, UTC; must precede today
  --unit UUID         Restrict to this assigned unit; otherwise choose an eligible unit
  --status STATUS     signed (default) or draft; both must pass signing validation
  --seed TEXT         Repeatable generated values and service times (IDs remain unique)
  --dry-run           Validate the complete batch, then roll back all generated records
  --help              Show this help

Loads .env.local when invoked through npm. Requires DATABASE_URL and the normal API
patient-key configuration. Uses operator database access and current agency
Demo/documentation permissions. No user passwords are required.
No API/web server is required. Existing calls are never reused. Retention starts now,
independently of the requested service dates. Each successful record is committed;
on failure, the current record rolls back and the command reports the completed count.
`;

export function parseOptions(argv, now = new Date()) {
  const { values } = parseArgs({ args: argv, options: Object.fromEntries([
    ...['agency', 'username', 'count', 'from', 'to', 'unit', 'status', 'seed'].map(key => [key, { type: 'string' }]),
    ...['dry-run', 'help'].map(key => [key, { type: 'boolean' }]),
  ]) });
  if (values.help) return { help: true };
  for (const key of ['agency', 'count', 'from', 'to']) {
    if (!values[key]?.trim()) throw new Error(`--${key} is required`);
  }
  if (values.username !== undefined && !values.username.trim()) throw new Error('--username must be non-empty when supplied');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  for (const key of ['agency', 'unit']) if (values[key] && !uuid.test(values[key])) throw new Error(`--${key} must be a UUID`);
  if (!/^[1-9]\d*$/.test(values.count) || Number(values.count) > 10000) throw new Error('--count must be an integer from 1 to 10000');
  for (const key of ['from', 'to']) {
    const value = values[key];
    const date = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) {
      throw new Error(`--${key} must be a real calendar date in YYYY-MM-DD format`);
    }
  }
  if (values.from > values.to) throw new Error('--from must be on or before --to');
  if (values.to >= now.toISOString().slice(0, 10)) throw new Error('--to must precede today so complete calls cannot extend into the future');
  if (values.from < '1950-01-01') throw new Error('--from must be on or after 1950-01-01');
  const status = values.status ?? 'signed';
  if (!['signed', 'draft'].includes(status)) throw new Error('--status must be signed or draft');
  return { ...values, agency: values.agency.toLowerCase(), count: Number(values.count), status, dryRun: values['dry-run'] === true };
}

export function seededRandom(seed) {
  return randomFromSeed(createHash('sha256').update(String(seed)).digest().readUInt32LE(0));
}

export function serviceTime(options, random) {
  const first = Date.parse(`${options.from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${options.to}T00:00:00Z`) - first) / 86400000) + 1;
  // A broad daytime/evening peak, with overnight calls still represented. These
  // are illustrative fixture weights, not an epidemiological model.
  const hour = weightedIndex([3, 2, 2, 2, 2, 3, 4, 5, 7, 8, 9, 9, 9, 9, 9, 10, 10, 9, 8, 7, 6, 5, 4, 3], random);
  // A 15-minute margin keeps pre-dispatch events inside the requested date range.
  const minute = hour === 0 ? 15 + Math.floor(random() * 45) : Math.floor(random() * 60);
  return new Date(first + Math.floor(random() * days) * 86400000 + hour * 3600000 + minute * 60000);
}

export function weightedIndex(weights, random) {
  let value = random() * weights.reduce((sum, weight) => sum + weight, 0);
  return weights.findIndex(weight => (value -= weight) < 0);
}

export { normal, operationalTimeline } from '@open-triage/contracts/synthetic-record-generator';
