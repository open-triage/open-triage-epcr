import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function parseKeyring(environment = process.env) {
  let parsed;
  try {
    parsed = JSON.parse(environment.OFFLINE_RECOVERY_WRAPPING_KEYS_JSON ?? "{}");
  } catch {
    throw new Error("OFFLINE_RECOVERY_WRAPPING_KEYS_JSON must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OFFLINE_RECOVERY_WRAPPING_KEYS_JSON must be a JSON object");
  }
  const keys = new Map();
  for (const [versionText, encoded] of Object.entries(parsed)) {
    if (!/^[1-9]\d*$/.test(versionText) || typeof encoded !== "string" || !canonicalBase64.test(encoded)) {
      throw new Error("Every wrapping key must have a positive integer version and canonical base64 value");
    }
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength !== 32) throw new Error(`Wrapping key version ${versionText} must decode to 32 bytes`);
    keys.set(Number(versionText), secret);
  }
  return keys;
}

function aad(row, version) {
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    organizationId: row.organization_id,
    reportId: row.report_id,
    ownerUserId: row.owner_user_id,
    recoveryHandle: row.recovery_handle,
    wrappingKeyVersion: version,
  }), "utf8");
}

export function rewrap(row, oldVersion, oldSecret, newVersion, newSecret) {
  const wrapped = Buffer.from(row.wrapped_data_key);
  if (wrapped.byteLength !== 48) throw new Error(`Envelope ${row.report_id} has an invalid wrapped key length`);
  const decipher = createDecipheriv("aes-256-gcm", oldSecret, Buffer.from(row.wrapping_nonce));
  decipher.setAAD(aad(row, oldVersion));
  decipher.setAuthTag(wrapped.subarray(32));
  const reportKey = Buffer.concat([decipher.update(wrapped.subarray(0, 32)), decipher.final()]);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", newSecret, nonce);
    cipher.setAAD(aad(row, newVersion));
    return { nonce, wrapped: Buffer.concat([cipher.update(reportKey), cipher.final(), cipher.getAuthTag()]) };
  } finally {
    reportKey.fill(0);
  }
}

export async function rotateOfflineRecoveryKeys({ client, oldVersion, newVersion, keys }) {
  if (!Number.isSafeInteger(oldVersion) || !Number.isSafeInteger(newVersion) || newVersion <= oldVersion) {
    throw new Error("NEW_OFFLINE_RECOVERY_KEY_VERSION must be greater than OLD_OFFLINE_RECOVERY_KEY_VERSION");
  }
  const oldSecret = keys.get(oldVersion);
  const newSecret = keys.get(newVersion);
  if (!oldSecret || !newSecret) throw new Error("The keyring must include both the old and new wrapping-key versions");

  await client.query("select offline_recovery.register_wrapping_key_version($1)", [newVersion]);
  const candidates = await client.query("select * from offline_recovery.rotation_candidates($1)", [oldVersion]);
  let rotated = 0;
  for (const row of candidates.rows) {
    const replacement = rewrap(row, oldVersion, oldSecret, newVersion, newSecret);
    const result = await client.query(
      "select offline_recovery.rotate_report_key($1, $2, $3, $4, $5) as rotated",
      [row.report_id, oldVersion, newVersion, replacement.nonce, replacement.wrapped],
    );
    if (result.rows[0]?.rotated) rotated += 1;
  }
  const coverageResult = await client.query(
    "select * from offline_recovery.rotation_coverage($1, $2)", [oldVersion, newVersion],
  );
  const coverage = coverageResult.rows[0];
  if (!coverage || Number(coverage.old_live_count) !== 0) {
    throw new Error(`Rotation coverage is incomplete: ${coverage?.old_live_count ?? "unknown"} live envelopes remain`);
  }
  await client.query("select offline_recovery.retire_wrapping_key_version($1)", [oldVersion]);
  return { rotated, oldVersion, newVersion, remainingOld: 0 };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const keys = parseKeyring();
  const oldVersion = Number(process.env.OLD_OFFLINE_RECOVERY_KEY_VERSION);
  const newVersion = Number(process.env.NEW_OFFLINE_RECOVERY_KEY_VERSION);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await rotateOfflineRecoveryKeys({ client, oldVersion, newVersion, keys });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    for (const secret of keys.values()) secret.fill(0);
    await client.end();
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
