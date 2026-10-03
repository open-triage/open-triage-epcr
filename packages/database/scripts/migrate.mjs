import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const migrationName = /^(\d+)_([a-z0-9][a-z0-9_-]*)\.sql$/;
const lockName = "open-triage-forward-only-migrations-v1";
const compatibleMigrationChecksums = new Map([
  // Portable role revokes and ordered table creation preserve applied Review schemas.
  ["20261002120000", new Map([["2fb0dc3e1670662eb6bce33967db23cdd3a0025b998efc644f58b397a0b40e61", "d45b66b2f9435917b144baefbe2fb464f0c0ab00f116f1454789fc3d895731bc"]])],
  ["20261002130000", new Map([["e8baa0838c366b1a2edcc7bca8564a988ec0cce1c735ca7354f4da085f73e856", "19082b9b0c590aecee96911ce47ff92cd5706fa6e1732a6461738c852b091d1e"]])],
  ["20261002180000", new Map([["cdbd5c0dffe3ad75eb9b850b75007030b91d5f5c9867559eec5c9dfdc82273bd", "6b3c2d561747c2e2e0ca262e15b7c1400b97aa5c098810ebc304d6d69b461bc9"]])],
  ["20261002190000", new Map([["a341b6742cd379fd314ee20ac1a57d7c964f32512f09f28423787f5d463cba3c", "c9d5c8cfec4bad632c0a25f07cf05c8a32608eadae19719a7b2e25fb7dd472b1"]])],
  ["20261002230000", new Map([["80d01b446a437628afa62af7ef562d27034e7afae960c748427e4ede20281a99", "04c21fa8ea8f7d1eebfdf53c41608926e2ce20b7f082daea0a476ccba29d5a76"]])],
  ["20261002260000", new Map([["d963d74efb42224eebace81356d445bc41a0e1af7c9d2122381073c6c8880c58", "6ac484ec5f6214ac28c0cfee15db2e4be0408e99569b38d87e0e4658049a585b"]])],
  ["20261002290000", new Map([["9dc0cb383e2350c165409c56e86efd3378789fdcd084e7ee5ddab4b59e2bbd71", "0827f66f7d354233f8f0fb2d71761d1306cf247c680119c03a7281ddfe643aab"]])],
  ["20261002300000", new Map([["7208ae35f0d373e4d491173da820a2e41cbbcc122e4d17e89fa965561ade57aa", "2fbd8bec7f68bfec323a0dfb80ac9d82e685f6110aa6a21027155fa582e72cbc"]])],
  ["20261002202737", new Map([["59d66301e77d60cb458d3bb2d0b94aa747debc5342aff87d20f7fb951ad181c9", "82f8bee7d5d7efc658a19ab8ae2df9371ea83e1c355c193235c2e3d2a435fc46"]])],
  ["20260912120000", new Map([
    [
      "de083488ce021a6cfd2333603b5e8e3da700553bc8f024840e3dd5c3b9ff4534",
      "a94e7492463a45e29089d56e0e1d8c46a31f544efe9af4ea93eabf7e60feeeed",
    ],
  ])],
  ["20260917113000", new Map([
    [
      "68fd47193095252e953fbeff93b5d55b1ee4aae2de95ee0f73809bd06792c926",
      "2e238c1a9b0a60e0d0bda9fb770953cbd5b8d5eda7cd0294233eae1b93e03979",
    ],
  ])],
  ["20260917210000", new Map([
    [
      "14062abc56f142bf24325219351bb72c58f8bf7e1ed2788af10c93a45d484a02",
      "28fa73f4c42fd059e2a7158eb307a128587cb45bb41038ce6a794969b9682b6d",
    ],
  ])],
  ["20260917220000", new Map([
    [
      "08938dfa65fa27d4995a63b410c6aefe821c352177a41e52d7a90c6af1e2d2b3",
      "ac4d01e02e24bcc04d8f4399cd9b5ab8247e39a83fa745a16b09bc3f48b22d67",
    ],
  ])],
  ["20260924093945", new Map([
    [
      "e3e817e9af9f02ad9c6bf9b7e03b46a4b15f270b4c93a1ff00f669752147b944",
      "768a78853408d97d5067162001123a41e7ca489ebe4312e952c7c2af51e090ff",
    ],
  ])],
  ["20260924140000", new Map([
    [
      "2fe89f68c1eb848eb9c29543598229518835e55b937ff9fa08730a45123a4245",
      "aef7c4d2b6c6cff3122d5398e2afbd75dcae2a161dd9b8a888c4bd10f5aafaf2",
    ],
  ])],
  ["20260924144000", new Map([
    [
      "8edb06193f60477cf3fadbe6aa83b15be299da939c522d1c40af397657dbdcd2",
      "2d40ec5cde635087833daf16222ed0b68de13fbc60870c8e1d21d0834fec2f5b",
    ],
  ])],
  ["20260924150000", new Map([
    [
      "176836305b05dcab49dbac62ba2634314dd01eec6eb1290fd72cf9d4669e1591",
      "23e65ad273a8fda571bb06d28ff71bc51de4ee5311943e01af75258b4adbb3be",
    ],
  ])],
  ["20260924151000", new Map([
    [
      "56ff86c7b6e21515ec7c205984afd43712c68ef99675f1c40235ac715e100f0f",
      "9947d86356a691e9cc25806a1fe73f35b0f805df1ed160434b25192403001bce",
    ],
  ])],
  ["20260924160000", new Map([
    [
      "b44deed4e702d5c88692e020c618bcaac35bced3e7d6c8baa6fe65f77c29fd1b",
      "f6228220ad3e6f2fdf427e01dd006ad7963e86ab3fdcb41f7afb48844253170a",
    ],
  ])],
]);

function isCompatibleMigrationChecksum(version, recordedChecksum, currentChecksum) {
  return compatibleMigrationChecksums.get(version)?.get(recordedChecksum) === currentChecksum;
}

export async function readMigrations(migrationsDirectory) {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    const match = migrationName.exec(entry.name);
    if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);
    const sql = await readFile(path.join(migrationsDirectory, entry.name), "utf8");
    migrations.push({
      version: match[1],
      name: match[2],
      checksum: createHash("sha256").update(sql).digest("hex"),
      sql,
    });
  }

  migrations.sort((left, right) => left.version.localeCompare(right.version));
  for (let index = 1; index < migrations.length; index += 1) {
    if (migrations[index - 1].version === migrations[index].version) {
      throw new Error(`Duplicate migration version: ${migrations[index].version}`);
    }
  }
  return migrations;
}

export async function applyMigrations(client, migrations, log = console) {
  log.info("Waiting for the deployment migration lock");
  await client.query("select pg_advisory_lock(hashtext($1))", [lockName]);
  log.info("Acquired the deployment migration lock");
  try {
    await client.query(`
      create schema if not exists supabase_migrations;
      create table if not exists supabase_migrations.schema_migrations (
        version text primary key,
        statements text[],
        name text
      );
      alter table supabase_migrations.schema_migrations
        add column if not exists statements text[];
      alter table supabase_migrations.schema_migrations
        add column if not exists name text;
      create schema if not exists open_triage_deploy;
      revoke all on schema open_triage_deploy from public;
      create table if not exists open_triage_deploy.migration_checksums (
        version text primary key references supabase_migrations.schema_migrations(version),
        checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
        recorded_at timestamptz not null default now()
      );
      revoke all on table open_triage_deploy.migration_checksums from public;
    `);

    const result = await client.query(
      `select history.version, checksums.checksum
       from supabase_migrations.schema_migrations history
       left join open_triage_deploy.migration_checksums checksums using (version)
       order by history.version`,
    );
    const applied = new Map(result.rows.map((row) => [row.version, row.checksum]));

    for (const migration of migrations) {
      const recordedChecksum = applied.get(migration.version);
      if (applied.has(migration.version)) {
        const compatibleChecksum = recordedChecksum && recordedChecksum !== migration.checksum &&
          isCompatibleMigrationChecksum(migration.version, recordedChecksum, migration.checksum);
        if (recordedChecksum && recordedChecksum !== migration.checksum && !compatibleChecksum) {
          throw new Error(`Applied migration ${migration.version} has been modified`);
        }
        const verification = compatibleChecksum
          ? "compatible legacy checksum verified"
          : recordedChecksum ? "checksum verified" : "trusted Supabase history";
        log.info(`Migration ${migration.version}_${migration.name} already applied (${verification})`);
        continue;
      }

      log.info(`Applying migration ${migration.version}_${migration.name}`);
      await client.query("begin");
      try {
        await client.query(migration.sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements)
           values ($1, $2, $3)`,
          [migration.version, migration.name, [migration.sql]],
        );
        await client.query(
          `insert into open_triage_deploy.migration_checksums (version, checksum)
           values ($1, $2)`,
          [migration.version, migration.checksum],
        );
        await client.query("commit");
        log.info(`Applied migration ${migration.version}_${migration.name}`);
      } catch (error) {
        await client.query("rollback");
        throw new Error(`Migration ${migration.version}_${migration.name} failed`, { cause: error });
      }
    }
    return migrations.filter((migration) => !applied.has(migration.version)).length;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [lockName]);
  }
}

export async function migrate({
  databaseUrl = process.env.DATABASE_URL,
  migrationsDirectory = path.resolve(import.meta.dirname, "../../../supabase/migrations"),
  log = console,
  Client = pg.Client,
} = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");
  const migrations = await readMigrations(migrationsDirectory);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await applyMigrations(client, migrations, log);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Schema changes never import or activate agency definitions.
  await migrate();
}
